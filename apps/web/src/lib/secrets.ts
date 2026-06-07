// Re-export the worker's secret helpers so web and worker share ONE age-crypto
// implementation. The route encrypts the per-agent secret at create time; the
// worker decrypts it at the `starting` transition.
export { writeSecret, readSecret, generateApiKey } from "@hermes/deployer-worker/secrets";
