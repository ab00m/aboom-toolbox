import process from 'node:process'
import spawn from 'cross-spawn'

for (const script of ['lint', 'typecheck', 'test', 'build']) {
  const result = spawn.sync('npm', ['run', script], { stdio: 'inherit', env: process.env })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    process.exit(result.status ?? 1)
}
