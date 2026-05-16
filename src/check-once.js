const { buildReport } = require('./monitor');

buildReport()
  .then(({ message }) => {
    console.log(message);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
