{ pkgs ? import <nixpkgs> { } }:

pkgs.buildFHSEnv {
  name = "electrify-nixos";
  # Electron loads GTK, sound and graphics libraries at runtime as well as at startup.
  includeClosures = true;
  targetPkgs = p: with p; [
    alsa-lib
    cups
    dbus
    glib
    gsettings-desktop-schemas
    gtk3
    gtk4
    libdrm
    libgbm
    libGL
    libnotify
    libpulseaudio
    libsecret
    (p.libxcomposite or xorg.libXcomposite)
    (p.libxdamage or xorg.libXdamage)
    (p.libxfixes or xorg.libXfixes)
    libxkbcommon
    (p.libxrandr or xorg.libXrandr)
    nspr
    nss
    udev
    vulkan-loader
    xdg-utils
  ];
  runScript = "${pkgs.coreutils}/bin/env";
}
