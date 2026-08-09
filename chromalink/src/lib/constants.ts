/** Protocol constants — the single source of truth shared by every module. */

export const MAGIC = 0xc7;
export const PROTOCOL_VERSION = 1;

export const GRID_SIZES = [60, 100, 140] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const DEFAULT_GRID: GridSize = 100;

export const SENDER_FPS_OPTIONS = [15, 20, 24] as const;
export type SenderFps = (typeof SENDER_FPS_OPTIONS)[number];
export const DEFAULT_FPS: SenderFps = 20;

/** Inner Reed–Solomon code shape: RS(255, 223) — 32 parity bytes per codeword. */
export const RS_DATA = 223;
export const RS_TOTAL = 255;
export const RS_PARITY = RS_TOTAL - RS_DATA;

/** Frame header: 28 payload bytes protected by RS(42, 28). */
export const HEADER_BYTES = 28;
export const HEADER_RS_PARITY = 14;

export const CAL_ROWS = 2;
export const FINDER_SIZE = 7;
export const BEACON_RESERVED = 7;

/** Laplacian-variance sharpness floor on the 160px grayscale downscale. */
export const SHARPNESS_MIN = 25;

export const WORKER_BUSY_POLICY = 'drop';

/** RaptorQ packet header (source block number u8 + encoding symbol id u24). */
export const PACKET_ID_BYTES = 4;
export const OTI_BYTES = 12;

/** Repair symbols are produced in batches of this many per source block. */
export const REPAIR_BATCH = 500;

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_ERROR = 'Max 64 MB';

/**
 * Largest transfer container the sender can produce: a 64 MiB file plus the
 * container's fixed fields and a maximal 255-byte filename (compression is
 * used only when strictly smaller). Any OTI declaring more is hostile.
 */
export const MAX_TRANSFER_CONTAINER_BYTES = MAX_FILE_BYTES + 1 + 255 + 8 + 32 + 1;
