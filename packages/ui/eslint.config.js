import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.property.name='toFixed']",
        message: "Use formatNumber or <Num> instead of toFixed in UI code.",
      },
    ],
  },
});
