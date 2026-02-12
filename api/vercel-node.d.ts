declare module "@vercel/node" {
  import type { IncomingMessage, ServerResponse } from "http";

  export interface VercelRequest extends IncomingMessage {
    query: Record<string, string | string[]>;
    cookies?: Record<string, string>;
    body?: any;
  }

  export interface VercelResponse extends ServerResponse {
    status(code: number): this;
    json(body: any): this;
    send(body: any): this;
  }
}
