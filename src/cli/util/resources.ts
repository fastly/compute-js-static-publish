/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

// The resources/ directory of this package. This file is
// build/cli/cli/util/resources.js in the package.
export const resourcesDir = path.resolve(import.meta.dirname, '../../../../resources');
