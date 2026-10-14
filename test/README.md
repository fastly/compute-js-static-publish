# Tests

The tests use the Node.js test runner (`node:test`). They import the compiled modules from `build/`. Thus each
`npm` script builds the package first. The scripts use glob patterns, so they need Node.js 21 or later.

Without credentials, `npm test` and `npm run test:e2e` run the unit tests, the local test, and the upgrade test. The
tests that need real resources are skipped. To also run them, see [Prepare the resources](#prepare-the-resources).

## Unit tests

```sh
npm test
```

The unit tests are in `test/unit`. They do not need the network or credentials. They test only the modules that
do not import `fastly:*`, because these modules cannot load in Node.js.

## End-to-end tests

```sh
npm run test:e2e
```

The end-to-end tests are in `test/e2e`. Each test scaffolds an app in a temporary directory. The app uses this
checkout through a `file:` dependency. The tests need network access for `npm install`.

| Test                     | What it does                                                                                                                                    | Needs                                     |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------|
| `local.test.js`          | Publishes with `--local`, and serves the app with `fastly compute serve`.                                                                       | The Fastly CLI                            |
| `upgrade-from-v7.test.js` | Scaffolds and publishes with v7 from npm, installs this checkout, and serves the content. This examines the upgrade steps in `MIGRATING.md`.    | The Fastly CLI                            |
| `kv-store.test.js`       | Publishes to a real KV Store two times, and makes sure that the second publish uploads nothing. Then deletes the collection and cleans.          | The environment variables below           |
| `s3.test.js`             | The same test with an S3-compatible bucket. It also serves the content from the bucket with `fastly compute serve`.                               | The Fastly CLI, and the variables below   |
| `deployed.test.js`       | Deploys an app to a real service. Makes sure that, without a purge, the response cache serves the old content, and that a publish with a purge makes it serve the new content. | The Fastly CLI, and the variables below   |

If a test does not have what it needs, it is skipped, and the output tells which environment variables to set.

### Environment variables

The tests read all credentials from the environment. Do not put credentials in the test files.

To keep the values in a file, copy `test/.env.sample` to `test/.env`, and set the values. Git ignores `test/.env`.
Then load the file before you run the tests:

```sh
set -a; . test/.env; set +a
npm run test:e2e
```

| Variable                  | Used by                         | Value                                                                    |
|---------------------------|---------------------------------|--------------------------------------------------------------------------|
| `FASTLY_API_TOKEN`        | `kv-store.test.js`, `deployed.test.js`, purge tests | An API token that can write to the KV Store. For the purge and deployed tests, it must also purge and deploy the service |
| `CJSP_TEST_KV_STORE_NAME` | `kv-store.test.js`, `deployed.test.js` | The name of a KV Store for tests                                         |
| `S3_ACCESS_KEY_ID`        | `s3.test.js`                    | An access key ID that can read and write the bucket                     |
| `S3_SECRET_ACCESS_KEY`    | `s3.test.js`                    | The secret access key                                                    |
| `CJSP_TEST_S3_REGION`     | `s3.test.js`                    | The region of the bucket                                                 |
| `CJSP_TEST_S3_BUCKET`     | `s3.test.js`                    | The name of a bucket for tests                                           |
| `CJSP_TEST_S3_ENDPOINT`   | `s3.test.js` (optional)         | The endpoint, for storage that is not AWS S3                             |
| `CJSP_TEST_SERVICE_ID`    | `kv-store.test.js`, `s3.test.js` (optional) | A Service ID to purge after publishing. You can use the service of `deployed.test.js` |
| `CJSP_TEST_DEPLOY_SERVICE_ID` | `deployed.test.js`         | A Compute service for tests. **The test replaces the active version of this service.** |
| `CJSP_TEST_DEPLOY_URL`    | `deployed.test.js`              | The URL of that service, for example `https://<name>.edgecompute.app`    |
| `KEEP_E2E_DIRS`           | all (optional)                  | Set to keep the temporary directories, to examine them after a test     |

The KV Store and S3 tests use a new publish ID for each run (for example `e2e-mf3k2a-1b2c3d`) and the collection
`e2e`. At the end, they delete the collection and run `clean`, and then make sure that no key with that publish ID
stays in storage. If a test stops before the end, the output shows the publish ID, so that you can delete the keys.
The tests set `FASTLY_SERVICE_ID` to an empty value for the CLI, so that the CLI purges only `CJSP_TEST_SERVICE_ID`.

Use a KV Store and a bucket that only tests use. The tests add and delete keys in them.

## Prepare the resources

Use resources that only the tests use. The tests add and delete keys, and `deployed.test.js` deploys and activates new
versions of its service. Set `FASTLY_API_TOKEN` before you run these commands. To delete the resources later, delete the
service and the KV Store.

### KV Store

Create a KV Store, and set `CJSP_TEST_KV_STORE_NAME` to its name:

```sh
fastly kv-store create --name=cjsp-test
```

The command shows the ID of the store (`StoreID`). You need it to link the store to the service.

### S3-compatible bucket

Create a bucket and an access key that can read and write it, for example in Fastly Object Storage. Set
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CJSP_TEST_S3_REGION`, `CJSP_TEST_S3_BUCKET`, and, for storage that is not
AWS S3, `CJSP_TEST_S3_ENDPOINT`. For Fastly Object Storage, the endpoint has the region in it, for example:

```sh
CJSP_TEST_S3_REGION=us-east-1
CJSP_TEST_S3_ENDPOINT=https://us-east-1.object.fastlystorage.app
```

Make sure that the region is the region of the bucket. With an incorrect region, a list of the buckets can show the
bucket, but all the operations on the bucket fail with `NoSuchBucket`.

### Service for `deployed.test.js`

Create a Compute service, give it a domain, and link the KV Store to it with the name of the store. The app reads the
store by this name.

```sh
fastly service create --name=cjsp-e2e-test --type=wasm
# The command shows the Service ID. Set CJSP_TEST_DEPLOY_SERVICE_ID to it.

fastly service domain create --service-id="$CJSP_TEST_DEPLOY_SERVICE_ID" --version=latest \
  --name=<unique name>.edgecompute.app
fastly service resource-link create --service-id="$CJSP_TEST_DEPLOY_SERVICE_ID" --version=latest \
  --resource-id=<KV Store ID> --name="$CJSP_TEST_KV_STORE_NAME"
```

Set `CJSP_TEST_DEPLOY_URL` to `https://<unique name>.edgecompute.app`. You can also set `CJSP_TEST_SERVICE_ID` to the
same Service ID, so that the KV Store and S3 tests also examine the purge.

The service does not need a package before the first run. The test deploys to the latest version, and activates it.
Thus the domain and the link become active with the first deployment. Later deployments clone the version, so they
stay. If you use a service that already has an active version, add `--autoclone` to the two commands.

The test takes approximately 3 to 10 minutes. It waits for the deployment, and for the KV Store to have the new index.
After the test, the app stays on the service, but the test deletes its content.
