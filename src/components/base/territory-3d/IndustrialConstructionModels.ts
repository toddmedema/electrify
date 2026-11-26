import { MeshBuilder } from "./MeshBuilder";
import { PALETTE as P } from "./Palette";
import { base, facilityModel, gable, switchgear } from "./StructureMesh";
import type {
  FacilityConstructionStage,
  FacilitySize,
  MapModel,
  Vec3,
} from "./Types";

const TAU = Math.PI * 2;

export function gasCombinedCycleConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const small = size === "small",
    large = size === "large";
  const width = small ? 0.46 : large ? 0.77 : 0.64,
    depth = small ? 0.36 : large ? 0.51 : 0.4;
  base(body, width, depth);

  const skidXs = small ? [-0.146] : large ? [-0.296, -0.183] : [-0.24],
    skidZ = small ? 0.014 : 0.026,
    skidLength = small ? 0.142 : large ? 0.226 : 0.186,
    skidRadius = small ? 0.036 : large ? 0.045 : 0.042,
    skidY = 0.067 + skidRadius,
    skidRear = skidZ - skidLength / 2;
  const vents = small ? [0.132] : large ? [-0.018, 0.14, 0.298] : [0.03, 0.19],
    recoveryZ = large ? -0.154 : -0.1,
    recoveryDepth = small ? 0.128 : large ? 0.17 : 0.15,
    recoveryLeft = vents[0] - (small ? 0.048 : 0.057),
    recoveryRight = vents[vents.length - 1] + (small ? 0.048 : 0.057),
    recoveryX = (recoveryLeft + recoveryRight) / 2,
    recoveryWidth = recoveryRight - recoveryLeft,
    recoveryFront = recoveryZ + recoveryDepth / 2;
  const condenserX = small ? 0.095 : large ? 0.19 : 0.153,
    condenserZ = small ? 0.091 : large ? 0.115 : 0.103,
    condenserWidth = small ? 0.119 : large ? 0.22 : 0.18,
    condenserDepth = small ? 0.079 : large ? 0.103 : 0.096;
  const slabTop = 0.036,
    plinthY = 0.058;
  body
    .box(
      [recoveryX, 0.047, recoveryZ],
      [recoveryWidth, 0.022, recoveryDepth],
      P.rock,
    )
    .box(
      [condenserX, 0.047, condenserZ],
      [condenserWidth, 0.022, condenserDepth],
      P.rock,
    );
  for (const x of skidXs)
    body.box(
      [x, 0.047, skidZ],
      [skidRadius * 2.2, 0.022, skidLength + 0.017],
      P.rockShade,
    );
  if (stage === 0) return facilityModel("gas", body, []);

  const skid = new MeshBuilder()
    .cylinder([0, 0, 0], skidRadius, skidRadius, skidLength, P.steel, 8)
    .build();
  for (const x of skidXs) {
    body.merge(skid, [x, skidY, skidRear], [Math.PI / 2, 0, 0]);
    for (const z of [skidRear + 0.024, skidRear + skidLength - 0.024])
      body.box(
        [x, (plinthY + skidY) / 2, z],
        [skidRadius * 1.5, skidY - plinthY, 0.023],
        P.steelShade,
      );
  }

  const beam = small ? 0.015 : 0.019,
    frameHeight =
      stage === 1
        ? small
          ? 0.067
          : 0.09
        : small
          ? 0.115
          : large
            ? 0.168
            : 0.144,
    roofY = plinthY + frameHeight,
    sideSpans = [
      recoveryZ - recoveryDepth / 2 + beam / 2,
      recoveryFront - beam / 2,
    ];
  for (const z of sideSpans) {
    for (const x of [
      recoveryLeft + beam / 2,
      ...vents,
      recoveryRight - beam / 2,
    ])
      body.box(
        [x, plinthY + frameHeight / 2, z],
        [beam, frameHeight, beam],
        P.steelShade,
      );
    body.box([recoveryX, roofY, z], [recoveryWidth, beam, beam], P.steelShade);
  }
  for (const x of [recoveryLeft + beam / 2, recoveryRight - beam / 2])
    body.box([x, roofY, recoveryZ], [beam, beam, recoveryDepth], P.steelShade);
  if (stage === 1) return facilityModel("gas", body, []);

  // The wide, low exhaust crossover from the gas skids feeds a separate recovery module.
  const lastSkidX = skidXs[skidXs.length - 1],
    ductWidth = small ? 0.045 : 0.055,
    ductEnd = recoveryLeft + (stage === 2 ? -0.031 : beam);
  for (const x of skidXs) {
    const crossoverStart = Math.min(skidRear, recoveryZ - ductWidth / 2);
    const crossoverEnd = Math.max(skidRear, recoveryZ + ductWidth / 2);
    body.box(
      [x, skidY, (crossoverStart + crossoverEnd) / 2],
      [ductWidth, ductWidth, crossoverEnd - crossoverStart],
      P.steelShade,
    );
  }
  body
    .box(
      [(skidXs[0] + ductEnd) / 2, skidY, recoveryZ],
      [ductEnd - skidXs[0], ductWidth, ductWidth],
      P.steel,
    )
    .box(
      [lastSkidX, (slabTop + skidY) / 2, recoveryZ],
      [ductWidth, skidY - slabTop, ductWidth],
      P.steelShade,
    )
    .box(
      [condenserX, plinthY + 0.034, condenserZ],
      [condenserWidth - 0.018, 0.068, condenserDepth - 0.016],
      P.cream,
    )
    .box(
      [condenserX, plinthY + 0.07, condenserZ],
      [condenserWidth - 0.012, 0.016, condenserDepth - 0.009],
      P.steelShade,
    );
  // Match the operating silhouette's cap height so the vents stay in place at handoff.
  const ventTop = small ? 0.248 : large ? 0.4 : 0.33,
    capThickness = 0.015,
    ventHeight = ventTop - roofY - capThickness;
  if (stage === 2) {
    body
      .box(
        [recoveryX, plinthY + frameHeight / 2, sideSpans[0]],
        [recoveryWidth - 2 * beam, frameHeight, beam],
        P.cream,
      )
      .box(
        [vents[0], roofY, recoveryZ],
        [beam * 1.6, beam, recoveryDepth],
        P.steel,
      )
      .cylinder(
        [vents[0], roofY + beam / 2, recoveryZ],
        0.023,
        0.019,
        ventHeight * 0.36,
        P.steelShade,
        8,
      );
    return facilityModel("gas", body, []);
  }

  body
    .box(
      [recoveryX, plinthY + frameHeight / 2, recoveryZ],
      [recoveryWidth - beam / 2, frameHeight, recoveryDepth - beam / 2],
      P.cream,
    )
    .box(
      [recoveryX, roofY, recoveryZ],
      [recoveryWidth, beam, recoveryDepth],
      P.steel,
    );
  for (const x of vents)
    body
      .cylinder(
        [x, roofY + beam / 2, recoveryZ],
        0.023,
        0.018,
        ventHeight,
        P.steelShade,
        8,
      )
      .cylinder(
        [x, roofY + ventHeight, recoveryZ],
        0.024,
        0.024,
        0.015,
        P.steel,
        8,
      );

  // Both steam-return stubs are mounted, with the foreground coupling still open.
  const returnY = plinthY + 0.044,
    returnX = condenserX,
    condenserBack = condenserZ - condenserDepth / 2 + 0.012,
    breakZ = (recoveryFront + condenserBack) / 2;
  for (const [from, to] of [
    [recoveryFront - 0.006, breakZ - 0.017],
    [condenserBack, breakZ + 0.017],
  ]) {
    body
      .box(
        [returnX, returnY, (from + to) / 2],
        [0.028, 0.028, Math.abs(to - from)],
        P.steelShade,
      )
      .box([returnX, returnY, to], [0.04, 0.038, 0.01], P.timber);
  }
  const switchgearZ = small ? 0.166 : 0.22;
  body.box([0, 0.014, switchgearZ], [0.26, 0.028, 0.074], P.rock);
  return facilityModel("gas", body, switchgear(body, switchgearZ));
}

export function biomassConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const small = size === "small";
  const layout = {
    small: {
      pad: [0.46, 0.36],
      hall: [0.055, 0.015, 0.245, 0.2, 0.135, 0.032],
      silos: [[-0.143, -0.024, 0.144]],
      radius: 0.059,
      bin: [-0.143, 0.12, 0.127, 0.055],
      stack: [0.138, 0.246],
    },
    medium: {
      pad: [0.64, 0.4],
      hall: [0.075, 0.015, 0.4, 0.28, 0.18, 0.045],
      silos: [[-0.225, -0.02, 0.23]],
      radius: 0.082,
      bin: [-0.19, 0.155, 0.19, 0.055],
      stack: [0.22, 0.33],
    },
    large: {
      pad: [0.77, 0.51],
      hall: [0.105, -0.015, 0.47, 0.33, 0.228, 0.055],
      silos: [
        [-0.304, -0.119, 0.305],
        [-0.217, 0.064, 0.25],
      ],
      radius: 0.077,
      bin: [-0.243, 0.183, 0.224, 0.07],
      stack: [0.266, 0.437],
    },
  }[size];
  const [padWidth, padDepth] = layout.pad;
  const [hallX, hallZ, width, depth, eave, rise] = layout.hall;
  const [binX, binZ, binWidth, binDepth] = layout.bin;
  const [stackX, stackHeight] = layout.stack;
  const { radius } = layout;
  base(body, padWidth, padDepth);
  body
    .box([binX, 0.046, binZ], [binWidth, 0.02, binDepth], P.rock)
    .cylinder([stackX, 0.036, -0.11], 0.034, 0.034, 0.016, P.rock, 8);
  if (stage < 2) body.box([hallX, 0.05, hallZ], [width, 0.028, depth], P.rock);

  for (const [x, z, height] of layout.silos) {
    if (stage < 2) {
      body.cylinder(
        [x, 0.036, z],
        radius + 0.008,
        radius + 0.008,
        0.014,
        P.rock,
        8,
      );
      const top = stage === 0 ? 0.064 : 0.05 + height * 0.66;
      // Open octagonal walls expose the work inside the silo before the cap goes on.
      for (let side = 0; side < 8; side++) {
        const point = (index: number, r: number, y: number): Vec3 => {
          const angle = (index * TAU) / 8;
          return [x + r * Math.cos(angle), y, z + r * Math.sin(angle)];
        };
        const next = side + 1,
          inner = radius - 0.012;
        body
          .quad(
            point(next, radius, 0.05),
            point(side, radius, 0.05),
            point(side, radius, top),
            point(next, radius, top),
            P.steel,
          )
          .quad(
            point(side, inner, 0.05),
            point(next, inner, 0.05),
            point(next, inner, top),
            point(side, inner, top),
            P.steelShade,
          )
          .quad(
            point(next, inner, top),
            point(next, radius, top),
            point(side, radius, top),
            point(side, inner, top),
            P.steelShade,
          );
      }
    } else {
      body
        .cylinder([x, 0.036, z], radius, radius, height, P.cream, 8)
        .cylinder(
          [x, 0.036 + height, z],
          radius + 0.005,
          0.02,
          small ? 0.048 : 0.06,
          P.forest,
          8,
        );
      for (const y of small ? [0.114] : [0.1, 0.21])
        body.cylinder(
          [x, y, z],
          radius + 0.002,
          radius + 0.002,
          0.01,
          P.steelShade,
          8,
        );
    }
  }

  if (stage === 1) {
    for (const x of [hallX - width / 2 + 0.02, hallX + width / 2 - 0.02]) {
      for (const z of [hallZ - depth / 2 + 0.02, hallZ + depth / 2 - 0.02])
        body.box(
          [x, (eave + 0.064) / 2, z],
          [0.019, eave - 0.064, 0.019],
          P.steelShade,
        );
      body.box([x, eave, hallZ], [0.02, 0.019, depth], P.steelShade);
    }
  }
  if (stage >= 1) {
    for (const z of [binZ - binDepth / 2, binZ + binDepth / 2])
      body.box([binX, 0.074, z], [binWidth, 0.037, 0.012], P.steelShade);
    body.box(
      [binX - binWidth / 2, 0.074, binZ],
      [0.012, 0.037, binDepth],
      P.steelShade,
    );
  }
  if (stage >= 2) {
    body.box(
      [hallX, (eave + 0.036) / 2, hallZ],
      [width, eave - 0.036, depth],
      P.cream,
    );
    gable(
      body,
      [hallX, eave, hallZ],
      [width + 0.02, rise, depth + 0.02],
      P.forest,
    );
    for (const direction of [-1, 1])
      body.box(
        [binX + direction * binWidth * 0.225, 0.078, binZ],
        [binWidth * 0.43, 0.042, binDepth - 0.02],
        P.timber,
      );
    body.cylinder(
      [stackX, 0.036, -0.11],
      0.027,
      0.022,
      stackHeight * (stage === 2 ? 0.66 : 1),
      P.steelShade,
      8,
    );

    const intakeX = binX + binWidth * 0.18;
    const outletX = hallX - width / 2;
    const outletZ = hallZ + depth * 0.23;
    const riseTo = eave - 0.014;
    body.box([intakeX, 0.079, binZ], [0.023, 0.086, 0.025], P.steelShade);
    for (const offset of [-0.013, 0.013])
      body.beam(
        [intakeX, 0.115, binZ + offset],
        [outletX, riseTo, outletZ + offset],
        0.005,
        P.steel,
      );
    if (stage === 3) {
      body.cylinder(
        [stackX, stackHeight - 0.005, -0.11],
        0.028,
        0.028,
        0.035,
        P.steel,
        8,
      );
      // Cover the uphill run while leaving both rails exposed over the chip intake.
      body.beam(
        [
          intakeX + (outletX - intakeX) * 0.43,
          0.115 + (riseTo - 0.115) * 0.43,
          binZ + (outletZ - binZ) * 0.43,
        ],
        [outletX, riseTo, outletZ],
        0.022,
        P.forest,
      );
    }
  }

  return facilityModel(
    "biomass",
    body,
    stage === 3 ? switchgear(body, small ? 0.166 : 0.22) : [],
  );
}

export function enhancedGeothermalConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const layout = {
    small: {
      pad: [0.459, 0.32],
      wells: [-0.172, -0.082],
      rows: [0.006],
      mast: 0.29,
      hall: [0.066, 0.025, 0.272, 0.171, 0.125],
      roof: [0.288, 0.027, 0.186],
      switchgear: 0.181,
    },
    medium: {
      pad: [0.64, 0.4],
      wells: [-0.235, -0.126],
      rows: [-0.086, 0.058],
      mast: 0.35,
      hall: [0.105, 0.06, 0.38, 0.24, 0.15],
      roof: [0.4, 0.035, 0.26],
      switchgear: 0.22,
    },
    large: {
      pad: [0.752, 0.46],
      wells: [-0.277, -0.154],
      rows: [-0.125, 0.014, 0.132],
      mast: 0.41,
      hall: [0.13, -0.046, 0.39, 0.246, 0.191],
      roof: [0.413, 0.043, 0.265],
      switchgear: 0.227,
    },
  } as const;
  const {
    pad,
    wells,
    rows,
    mast,
    hall,
    roof,
    switchgear: switchgearZ,
  } = layout[size];
  const [injection, production] = wells;
  const [hallX, hallZ, hallWidth, hallDepth, hallTop] = hall;
  const drillZ = rows[rows.length - 1];
  const padTop = 0.036;
  const pipeY = 0.109;
  const trenchZ = (rows[0] + drillZ) / 2;
  const trenchLength = drillZ - rows[0] + 0.13;
  const headerEnd = drillZ + 0.064;

  base(body, pad[0], pad[1]);
  // The return trench remains visible between the paired fields until surfacing.
  if (stage < 3)
    body.box(
      [(injection + production) / 2, padTop + 0.001, trenchZ],
      [0.031, 0.004, trenchLength],
      P.earthShade,
    );
  for (const z of rows) {
    for (const x of wells) {
      const isInjection = x === injection;
      body
        .box([x, padTop - 0.001, z], [0.072, 0.01, 0.07], P.earth)
        .cylinder([x, padTop + 0.004, z], 0.027, 0.024, 0.014, P.steelShade)
        .cylinder(
          [x, padTop + 0.018, z],
          0.015,
          0.015,
          stage === 0 ? 0.004 : pipeY - padTop - 0.018,
          isInjection ? P.ink : P.steel,
        );
      if (stage >= 2)
        body.cylinder(
          [x, pipeY - 0.006, z],
          0.02,
          0.02,
          0.012,
          isInjection ? P.steelShade : P.mint,
        );
    }
  }

  if (stage < 2) {
    body.box(
      [hallX, padTop + 0.003, hallZ],
      [hallWidth, 0.006, hallDepth],
      P.rock,
    );
  } else {
    // The exterior remains roofless during test-skid installation.
    const wallTop = stage === 2 ? hallTop * 0.8 : hallTop;
    body.box(
      [hallX, (padTop + wallTop) / 2, hallZ],
      [hallWidth, wallTop - padTop, hallDepth],
      P.cream,
    );
    if (stage === 3) gable(body, [hallX, hallTop, hallZ], roof, P.steel);
  }

  if (stage === 1) {
    // A tapered rig with cross-bracing bears on the active bore's timber mat.
    body.box(
      [injection, padTop + 0.002, drillZ],
      [0.096, 0.005, 0.093],
      P.timber,
    );
    for (const side of [-1, 1]) {
      const outerX = injection + side * 0.046;
      const crownX = injection + side * 0.013;
      for (const face of [-1, 1]) {
        const footZ = drillZ + face * 0.034;
        const crownZ = drillZ + face * 0.011;
        body.beam(
          [outerX, padTop + 0.004, footZ],
          [crownX, mast, crownZ],
          0.009,
          P.ink,
        );
      }
      body.beam(
        [outerX, padTop + 0.006, drillZ + 0.034],
        [injection + side * 0.028, mast * 0.62, drillZ - 0.022],
        0.007,
        P.steelShade,
      );
      body.beam(
        [injection + side * 0.028, mast * 0.62, drillZ - 0.022],
        [crownX, mast, drillZ + 0.011],
        0.007,
        P.steelShade,
      );
    }
    body
      .box([injection, mast, drillZ], [0.046, 0.015, 0.04], P.steel)
      .beam(
        [injection, mast, drillZ],
        [injection, pipeY, drillZ],
        0.008,
        P.steel,
      );
  }

  if (stage >= 2) {
    // The temporary skid supports both headers as they approach the test crossing.
    const skidX = (injection + production) / 2;
    body.box(
      [skidX, padTop + 0.008, headerEnd - 0.02],
      [production - injection + 0.047, 0.016, 0.075],
      P.timber,
    );
    for (const [index, x] of wells.entries()) {
      const color = index === 0 ? P.steelShade : P.steel;
      body
        .beam(
          [x, pipeY, rows[0] - 0.027],
          [x, pipeY, headerEnd],
          0.011,
          color,
          6,
        )
        .box([x, 0.071, headerEnd - 0.039], [0.035, 0.054, 0.022], P.rockShade)
        .box([x, pipeY, rows[0] - 0.028], [0.031, 0.029, 0.012], P.steelShade);
    }
    const crossEnd = stage === 2 ? injection + 0.025 : production;
    body
      .beam(
        [injection, pipeY, headerEnd],
        [crossEnd, pipeY, headerEnd],
        0.011,
        P.steel,
        6,
      )
      .box([crossEnd, pipeY, headerEnd], [0.014, 0.032, 0.032], P.steelShade)
      .box([skidX, 0.059, headerEnd - 0.044], [0.042, 0.03, 0.044], P.ink)
      .cylinder(
        [skidX, 0.074, headerEnd - 0.044],
        0.021,
        0.017,
        0.067,
        P.steel,
        8,
      )
      .beam(
        [skidX, pipeY, headerEnd - 0.044],
        [production, pipeY, headerEnd - 0.044],
        0.007,
        P.ink,
      )
      .cylinder(
        [skidX, 0.14, headerEnd - 0.044],
        0.014,
        0.014,
        0.012,
        P.mint,
        8,
      );
  }

  if (stage < 3) return facilityModel("geothermal", body, []);

  // The capped test skid remains on site during commissioning.
  const serviceX = hallX + hallWidth * 0.26;
  body
    .cylinder(
      [serviceX, hallTop - 0.004, hallZ - hallDepth * 0.27],
      0.018,
      0.018,
      0.075,
      P.steel,
      6,
    )
    .box(
      [hallX + hallWidth * 0.28, padTop + 0.038, hallZ + hallDepth / 2 + 0.006],
      [0.053, 0.065, 0.012],
      P.ink,
    )
    .box(
      [
        hallX + hallWidth * 0.28 + 0.03,
        padTop + 0.038,
        hallZ + hallDepth / 2 + 0.022,
      ],
      [0.008, 0.065, 0.044],
      P.steelShade,
    );
  return facilityModel("geothermal", body, switchgear(body, switchgearZ));
}
