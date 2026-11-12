import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["migrations/**", "coverage/**"] },
  ...tseslint.configs.recommended,
  // Leaving a key out of an object with `{ key, ...rest }` is how a settings group is dropped.
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
);
