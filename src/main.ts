import './style.css';
import { App } from './app';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) new App(root).start();
