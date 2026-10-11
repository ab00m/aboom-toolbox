import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'

const [tarball, version, name] = process.argv.slice(2)
const versionPath = `/releases/download/v${version}/${name}.tgz`
const server = createServer((request, response) => {
  if (request.url === `/releases/latest/download/${name}.tgz`) {
    response.writeHead(302, { location: versionPath })
    response.end()
    return
  }
  if (request.url !== versionPath) {
    response.writeHead(404)
    response.end()
    return
  }
  response.writeHead(200, { 'content-type': 'application/gzip' })
  createReadStream(tarball).pipe(response)
})
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }))
process.on('disconnect', () => server.close())
