import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    // The React Compiler lint rules flag legitimate patterns in this codebase (syncing props → state in effects,
    // Date.now() for client-only timestamps, module-level component helpers). Tracked as warnings, not build blockers.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "@next/next/no-img-element": "off",
    },
  },
];
