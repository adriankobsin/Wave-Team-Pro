/** Labels shared by the site pages (server) and their editable tables (client). */
export const DECKS: Record<string, string> = { TD: "Tank deck", LD: "Lower deck", MD: "Main deck", OD: "Owner's deck", BD: "Bridge deck", SD: "Sun deck", UD: "Upper deck" };
export const TEST_RESULT: Record<string, { label: string; tone: "neutral" | "ok" | "danger" | "warn" }> = {
  not_tested: { label: "Not tested", tone: "neutral" },
  passed: { label: "Passed", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  needs_review: { label: "Needs review", tone: "warn" },
  retest: { label: "Re-test required", tone: "warn" },
};
export const ITEM_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "danger" | "warn" }> = {
  planned: { label: "Planned", tone: "neutral" },
  delivered: { label: "Delivered", tone: "neutral" },
  installed: { label: "Installed", tone: "warn" },
  commissioned: { label: "Commissioned", tone: "ok" },
  tested: { label: "Tested", tone: "ok" },
  fault: { label: "Fault", tone: "danger" },
};

export const DISCIPLINES: [string, string][] = [
  ["general", "General arrangement"], ["lighting", "Lighting"], ["control", "Keypads / control"], ["av", "AV"], ["wifi", "Wi-Fi / access points"],
  ["data", "LAN / data"], ["cctv", "CCTV"], ["access", "Access control"], ["audio", "Speakers / audio"], ["power", "Power"], ["other", "Other"],
];

/** Brands commonly installed by AV / systems integrators; the project's own (from the spreadsheet or added by hand) are offered too. */
export const MANUFACTURERS = [
  "Apple", "APC", "Araknis", "Axis", "Bang & Olufsen", "Barco", "Bose", "Cisco", "Control4", "Crestron", "Dell", "Eaton", "Epson", "Extron",
  "Fortinet", "Furman", "Grandstream", "Hikvision", "JBL", "Kaleidescape", "KEF", "LG", "Lindy", "Lutron", "Meridian", "Middle Atlantic",
  "Netgear", "Origin Acoustics", "Panasonic", "Peplink", "Q-SYS", "Ruckus", "Samsung", "Savant", "Sennheiser", "Shure", "Sonance", "Sonos",
  "Sony", "Starlink", "Steinway Lyngdorf", "Synology", "Triad", "Ubiquiti", "Yamaha",
];
export const DEVICE_TYPES = [
  "Access Point", "Amp", "Camera", "Display", "Fixed Phone", "Intercom", "IO", "Keypad", "Lan Port", "PDU", "Processor", "Server", "Speaker",
  "Subwoofer", "Switch", "Touch Panel", "TV", "UPS", "Video Decoder", "Video Encoder", "Wireless Phone",
];

/** Things placed on drawings: label, short tag shown in the dot, and its colour. */
/** `box`: drawn as a square (control boxes, panels, racks) instead of a round dot. */
export const MARKER_KINDS: Record<string, { label: string; short: string; color: string; box?: boolean }> = {
  keypad: { label: "Keypad", short: "K", color: "#b07d2b" },
  touch_panel: { label: "Touch panel", short: "TP", color: "#7c3aed" },
  access_point: { label: "Access point", short: "AP", color: "#0284c7" },
  speaker: { label: "Speaker", short: "SP", color: "#16a34a" },
  subwoofer: { label: "Subwoofer", short: "SUB", color: "#166534" },
  tv: { label: "TV / display", short: "TV", color: "#db2777" },
  camera: { label: "Camera", short: "CAM", color: "#dc2626" },
  sensor: { label: "Sensor", short: "S", color: "#ca8a04" },
  data_point: { label: "Data point", short: "D", color: "#475569" },
  intercom: { label: "Intercom", short: "IC", color: "#9333ea" },
  phone: { label: "Phone", short: "PH", color: "#0d9488" },
  light: { label: "Light", short: "L", color: "#f59e0b" },
  shade: { label: "Shade control box", short: "SH", color: "#0891b2", box: true },
  lighting_panel: { label: "Lighting panel", short: "LP", color: "#ea580c", box: true },
  rack: { label: "Rack", short: "R", color: "#334155", box: true },
  other: { label: "Other", short: "•", color: "#6b7280" },
};

/** The layer a type of item goes on when none is chosen, e.g. access points → "Access points". */
export const MARKER_LAYER_NAMES: Record<string, string> = {
  keypad: "Keypads", touch_panel: "Touch panels", access_point: "Access points", speaker: "Speakers", subwoofer: "Subwoofers", tv: "TVs and displays",
  camera: "Cameras", sensor: "Sensors", data_point: "Data points", intercom: "Intercoms", phone: "Phones", light: "Lights", shade: "Shades", lighting_panel: "Lighting panels", rack: "Racks", other: "Other",
};
