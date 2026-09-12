window.addEventListener('error', function(e) {
  const fs = require('fs');
  fs.appendFileSync('/tmp/versa-frontend.log', e.error ? e.error.stack : e.message + '\n');
});
window.addEventListener('unhandledrejection', function(e) {
  const fs = require('fs');
  fs.appendFileSync('/tmp/versa-frontend.log', e.reason ? e.reason.stack : e.reason + '\n');
});
