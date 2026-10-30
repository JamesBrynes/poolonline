# 备用本地服务器（没装 Node 时 start.bat 会用它）：禁止缓存，并保证 .js 的类型正确
import http.server, socketserver, os, mimetypes
os.chdir(os.path.dirname(os.path.abspath(__file__)))
mimetypes.add_type('text/javascript', '.js')
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
with socketserver.TCPServer(('', 3000), H) as s:
    print('打开 http://localhost:3000')
    s.serve_forever()
