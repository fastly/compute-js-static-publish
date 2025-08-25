import { createDefaultPreset } from 'ts-jest';

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
export default {
    testEnvironment: "node",
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+.tsx?$': [
            'ts-jest', {
                useESM: true,
                tsconfig: {
                    isolatedModules: true,
                    module: 'esnext'
                }
            }
        ],
        ...tsJestTransformCfg,
    },
};