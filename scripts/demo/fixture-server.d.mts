import type { Server } from "node:http";

export type FixtureDocuments = {
  indexHtml: string;
  detailHtml: string;
};

export type FixtureRequest = {
  method: string;
  path: string;
};

export declare function loadFixtureDocuments(root: string): Promise<FixtureDocuments>;
export declare function createFixtureRequestHandler(
  documents: FixtureDocuments,
  requestLog?: FixtureRequest[],
): (request: { url?: string; method?: string }, response: unknown) => void;

export type FixtureServer = {
  server: Server;
  port: number;
  baseUrl: string;
  requests: FixtureRequest[];
  close(): Promise<void>;
};

export declare function startFixtureServer(input: {
  port: number;
  host: string;
  root: string;
  documents?: FixtureDocuments;
  requestLog?: FixtureRequest[];
}): Promise<FixtureServer>;
export declare function closeFixtureServer(server: Server): Promise<void>;
