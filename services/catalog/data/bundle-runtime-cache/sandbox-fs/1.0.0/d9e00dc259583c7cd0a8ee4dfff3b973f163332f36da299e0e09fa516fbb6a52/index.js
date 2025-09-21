exports.handler = async function () {
  const fs = require('fs');
  return { status: 'succeeded', result: fs.existsSync('/') };
};
