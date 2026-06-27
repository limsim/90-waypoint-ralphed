/** Driven port: cooperatively yield control back to the event loop. */
export interface Yield {
  yieldToEventLoop(): Promise<void>;
}
