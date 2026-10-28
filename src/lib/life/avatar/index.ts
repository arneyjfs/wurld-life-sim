/**
 * LIFE-NPC-2 (v2): public surface of the avatar part system.
 *
 * Also the entry the art sampler bundles (see
 * tests/experiments/avatar-svg-vs-pixel/README.md), so the preview always
 * renders the REAL library rather than a drifting copy.
 */
export { assembleAvatar, ZAvatarParams } from './assemble';
export type { AvatarParams, AssembleResult } from './assemble';
export { OPTIONS, A, shade } from './parts';
