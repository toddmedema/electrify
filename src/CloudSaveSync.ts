import type { CloudSaveHead, CloudSaveTransport } from "./CloudSaveTransport";
import { CloudConflict } from "./CloudSaveTransport";
import { newSaveId, SaveRepository } from "./SaveRepository";
import type { SaveMetadata, SaveRecord } from "./Types";
import { DAYS_PER_YEAR } from "./Constants";

export const AUTO_CLOUD_SAVE_MS = 5 * 60 * 1000;

/** Reconcile backups without making cloud availability a dependency of loading or saving. */
export class CloudSaveSync {
  constructor(
    private repository: SaveRepository,
    private transport: CloudSaveTransport,
  ) {}

  async sync(
    uid: string,
    current: () => boolean = () => true,
    options: { automatic?: boolean; forceIds?: ReadonlySet<string> } = {},
  ): Promise<{ conflicts: boolean; deferred: boolean; failed?: boolean }> {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      return navigator.locks.request(`electrify-cloud-sync:${uid}`, () =>
        current()
          ? this.reconcile(uid, current, options)
          : { conflicts: false, deferred: false },
      );
    }
    return this.reconcile(uid, current, options);
  }

  private async reconcile(
    uid: string,
    current: () => boolean,
    options: { automatic?: boolean; forceIds?: ReadonlySet<string> },
  ): Promise<{ conflicts: boolean; deferred: boolean; failed?: boolean }> {
    const remote = new Map(
      (await this.transport.list(uid)).map((head) => [head.id, head]),
    );
    let conflicts = false;
    let deferred = false;
    let failed = false;
    for (const deletion of await this.repository.pendingCloudDeletes(uid)) {
      if (!current()) return { conflicts, deferred };
      const head = remote.get(deletion.id);
      if (head?.invalid) {
        failed = true;
        remote.delete(deletion.id);
        continue;
      }
      if (!head || !head.deleted) {
        if (
          head &&
          deletion.version &&
          deletion.version !== head.version &&
          (!deletion.writerDeviceId ||
            deletion.writerDeviceId !== head.writerDeviceId ||
            deletion.writerLocalId !== head.writerLocalId)
        ) {
          // A newer remote edit wins over an older deletion; keep that progress locally.
          conflicts = true;
          await this.repository.clearCloudDelete(deletion.key);
          continue;
        }
        try {
          const version = await this.transport.write(
            uid,
            deletion.id,
            head?.version,
            null,
          );
          remote.set(deletion.id, {
            id: deletion.id,
            version,
            deleted: true,
            chunks: [],
          });
        } catch (error) {
          if (!(error instanceof CloudConflict)) {
            failed = true;
            remote.delete(deletion.id);
            continue;
          }
          // The list became stale, or a first upload raced this tombstone. Retry the
          // durable deletion after reading the committed version; don't restore it yet.
          remote.delete(deletion.id);
          deferred = true;
          continue;
        }
      }
      if (!current()) return { conflicts, deferred };
      await this.repository.clearCloudDelete(deletion.key);
    }
    for (const listed of await this.repository.list()) {
      let entry = listed;
      if (!current()) return { conflicts, deferred };
      if (entry.cloud && entry.cloud.uid !== uid) continue;
      const cloudId = entry.cloud?.id || entry.id;
      const head = remote.get(cloudId);
      remote.delete(cloudId);
      if (head?.invalid) {
        failed = true;
        continue;
      }
      try {
        // Another tab may observe our committed upload before its acknowledgement.
        // Recognize that exact local source instead of forking the same progress.
        if (
          head &&
          entry.cloud?.writerDeviceId &&
          entry.cloud.writerDeviceId === head.writerDeviceId &&
          entry.id === head.writerLocalId &&
          head.sourceRevision &&
          head.sourceRevision <= entry.revision &&
          head.version !== entry.cloud.version
        ) {
          await this.repository.acknowledgeCloud(
            entry.id,
            uid,
            cloudId,
            head.sourceRevision,
            head.version,
            {
              uploadedAt: head.uploadedAt,
              uploadedMinute: head.uploadedMinute,
            },
          );
          const latest = (await this.repository.list()).find(
            (candidate) => candidate.id === entry.id,
          );
          if (!latest) {
            deferred = true;
            continue;
          }
          entry = latest;
        }
        const dirty =
          !entry.cloud || entry.cloud.syncedRevision !== entry.revision;
        if (
          (dirty || !head) &&
          options.automatic &&
          !options.forceIds?.has(entry.id) &&
          entry.cloud?.uploadedAt !== undefined &&
          entry.cloud.uploadedMinute !== undefined
        ) {
          // Keep the checkpoint in IndexedDB so reloads and other tabs cannot
          // turn frequent device saves into frequent cloud uploads.
          if (Date.now() - entry.cloud.uploadedAt < AUTO_CLOUD_SAVE_MS) {
            deferred = true;
            continue;
          }
          const record = await this.repository.read(entry.id);
          if (
            record.save.game.date.minute - entry.cloud.uploadedMinute <
            DAYS_PER_YEAR * 1440
          ) {
            deferred = true;
            continue;
          }
        }
        if (head && head.version !== entry.cloud?.version) {
          if (!dirty) {
            const record = head.deleted
              ? null
              : await this.transport.read(head);
            if (!current()) return { conflicts, deferred };
            if (
              !(await this.repository.applyCloud(
                uid,
                cloudId,
                head.version,
                record,
                entry,
              ))
            )
              deferred = true;
            continue;
          }
          // Concurrent offline progress is a new branch, never a last-writer-wins overwrite.
          conflicts = true;
          const branchId = newSaveId();
          if (!(await this.upload(uid, entry, branchId, undefined, current))) {
            deferred = true;
            continue;
          }
          if (!head.deleted && current())
            await this.restore(uid, head, current);
        } else if (dirty || !head) {
          try {
            if (
              !(await this.upload(
                uid,
                entry,
                cloudId,
                entry.cloud?.version,
                current,
              ))
            )
              deferred = true;
          } catch (error) {
            if (!(error instanceof CloudConflict)) throw error;
            // Re-read on the next pass instead of overwriting an edit made after list().
            deferred = true;
          }
        }
      } catch (error) {
        if (error instanceof CloudConflict) deferred = true;
        else failed = true;
      }
    }
    for (const head of remote.values()) {
      if (!current()) return { conflicts, deferred };
      if (head.invalid) {
        failed = true;
        continue;
      }
      if (!head.deleted) {
        try {
          await this.restore(uid, head, current);
        } catch {
          failed = true;
        }
      }
    }
    return { conflicts, deferred, failed };
  }

  private async restore(
    uid: string,
    head: CloudSaveHead,
    current: () => boolean,
  ): Promise<void> {
    const record = await this.transport.read(head);
    if (current())
      await this.repository.applyCloud(uid, head.id, head.version, record);
  }

  private async upload(
    uid: string,
    entry: SaveMetadata,
    cloudId: string,
    expected: string | undefined,
    current: () => boolean,
  ): Promise<boolean> {
    if (!current()) return false;
    if (!(await this.repository.bindCloud(entry.id, uid, cloudId, entry)))
      return false;
    const record: SaveRecord = await this.repository.read(entry.id);
    if (!current()) return false;
    const version = await this.transport.write(uid, cloudId, expected, record);
    // A committed write must update its original account's local bookkeeping even
    // if auth changed meanwhile, or signing back in would duplicate that same save.
    await this.repository.acknowledgeCloud(
      entry.id,
      uid,
      cloudId,
      record.metadata.revision,
      version,
      {
        uploadedAt: Date.now(),
        uploadedMinute: record.save.game.date.minute,
      },
    );
    return true;
  }
}
