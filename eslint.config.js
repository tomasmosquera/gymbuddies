const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/*', 'supabase/functions/**'],
  },
  {
    rules: {
      // This project fetches on mount with plain useEffect + useState
      // (no react-query/SWR, to keep MVP dependencies minimal); that
      // standard pattern is exactly what this rule flags.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
