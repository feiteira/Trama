import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppProps } from './App';
import { createTauriPlatform, isTauri } from './platform/tauri';
import './ui/fonts.css';
import './ui/tokens.css';
import './ui/app.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  let props: AppProps;
  if (isTauri()) {
    props = { platform: createTauriPlatform() };
  } else {
    // In a plain browser Trama runs the demo: a fictional library held in memory only.
    const { bootDemo } = await import('./demo/boot');
    props = await bootDemo();
  }
  // No StrictMode: its doubled effects would run discovery (and the example library's
  // creation) twice against the same storage.
  root.render(<App {...props} />);
}

void start();
