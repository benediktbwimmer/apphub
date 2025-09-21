exports.handler = async function (context) {
  context.logger('echo-handler start', { parameters: context.parameters });
  await context.update({ context: { progress: 'halfway' } });
  return {
    status: 'succeeded',
    result: { echoed: context.parameters },
    metrics: { handler: 'ok' },
    context: { notes: 'finished' }
  };
};
