import {
  readdirSync,
} from "node:fs";
import {
  join,
  relative,
  resolve,
} from "node:path";
import {
  spawnSync,
} from "node:child_process";
import {
  fileURLToPath,
} from "node:url";


const frontendRoot =
  resolve(
    fileURLToPath(
      new URL(
        "..",
        import.meta.url,
      ),
    ),
  );

const sourceRoot =
  join(
    frontendRoot,
    "src",
  );


function collectTests(
  directory,
) {
  const found = [];

  for (
    const entry
    of readdirSync(
      directory,
      {
        withFileTypes:
          true,
      },
    )
  ) {
    const path =
      join(
        directory,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      found.push(
        ...collectTests(
          path,
        ),
      );

      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(
        ".test.js",
      )
    ) {
      found.push(
        path,
      );
    }
  }

  return found;
}


const tests =
  collectTests(
    sourceRoot,
  )
    .sort()
    .map(
      (path) =>
        relative(
          frontendRoot,
          path,
        ),
    );

if (
  tests.length === 0
) {
  console.error(
    "No frontend .test.js files were discovered.",
  );

  process.exit(
    1,
  );
}

console.log(
  `Running ${tests.length} frontend test files.`,
);

const result =
  spawnSync(
    process.execPath,
    [
      "--test",
      ...tests,
    ],
    {
      cwd:
        frontendRoot,
      stdio:
        "inherit",
    },
  );

if (
  result.error
) {
  throw result.error;
}

process.exit(
  result.status ?? 1,
);
