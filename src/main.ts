import './ui/styles.css';
import { LiveEdgeStudioApp } from './ui/app';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root element');
  const app = new LiveEdgeStudioApp(root);
  await app.mount();
}

void bootstrap();
