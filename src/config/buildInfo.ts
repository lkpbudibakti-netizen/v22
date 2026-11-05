declare const __APP_BUILD_SHA__: string | null;
declare const __APP_BUILD_ID__: string;
declare const __APP_BUILD_DIRTY__: boolean | null;

export const APP_BUILD_SHA: string | null = typeof __APP_BUILD_SHA__ === 'string' ? __APP_BUILD_SHA__ : null;
export const APP_BUILD_ID: string = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'runtime-unknown';
export const APP_BUILD_DIRTY: boolean | null = typeof __APP_BUILD_DIRTY__ === 'boolean' ? __APP_BUILD_DIRTY__ : null;
