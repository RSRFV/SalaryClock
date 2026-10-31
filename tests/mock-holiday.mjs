/** 本地模拟节假日上游，供测试与离线演示使用 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8791);
const YEAR_DEFAULT = 2026;

http
  .createServer((req, res) => {
    if (req.url && req.url.startsWith('/holiday/')) {
      const year = Number(req.url.split('/').pop()) || YEAR_DEFAULT;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code: 0,
          holiday: {
            '01-01': { holiday: true, name: '元旦' },
            '05-01': { holiday: true, name: '劳动节' },
            '10-01': { holiday: true, name: '国庆节' },
            '10-02': { holiday: true, name: '国庆节' },
            '10-03': { holiday: false, name: '调休上班' },
          },
        }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock holiday upstream → http://127.0.0.1:${PORT}/holiday/{year}`));
