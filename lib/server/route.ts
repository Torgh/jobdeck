import "server-only";
import { NotFound } from "./jobOps";

/** Runs a route handler body and turns errors into JSON responses the board can show. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    const status = e instanceof NotFound ? 404 : e instanceof SyntaxError ? 400 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
