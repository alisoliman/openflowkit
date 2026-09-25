/** Export handlers report handled failures without rejecting event-handler promises. */
export type ExportResult =
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'cancelled' };

export type ExportCallbackResult = void | ExportResult | Promise<void | ExportResult>;
