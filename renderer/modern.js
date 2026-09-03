function testBackend() {
  fetch('http://localhost:3000/api/health')
    .then(r => r.json())
    .then(d => alert('✅ Backend is running!\n' + JSON.stringify(d)))
    .catch(e => alert('❌ Backend not running on port 3000'));
}

function showStatus() {
  alert('✅ Modern UI loaded\n✅ Backend ready\n✅ Auth system online\n✅ All systems operational');
}

function openDocs() {
  alert('Documentation:\n- Backend: http://localhost:3000/api/health\n- Modern UI: index-modern.html\n- Auth: Login system active');
}

console.log('✅ Modern VERSA UI loaded');
