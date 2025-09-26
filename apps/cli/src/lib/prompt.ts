import readline from 'node:readline';

export async function confirmPrompt(message: string, defaultValue = false): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    rl.question(`${message} ${suffix} `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        resolve(defaultValue);
        return;
      }
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

