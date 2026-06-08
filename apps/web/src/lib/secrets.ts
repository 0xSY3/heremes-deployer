// Re-export the worker's DB-backed secret helpers so web and worker share ONE
// implementation over Postgres (no `age` binary or shared disk — required for
// the split Vercel-API / VPS-worker deployment). The route encrypts the
// per-agent secret at create time; the worker decrypts it at `starting`.
export { writeSecret, readSecret, generateApiKey } from "@hermes/deployer-worker/db-secrets";
