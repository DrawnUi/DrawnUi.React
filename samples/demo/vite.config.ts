import { defineSample } from "../vite.shared";
import { drawnUiStatic } from "../../src/vite"; // consumers: import { drawnUiStatic } from "drawnui-react/vite"

const config = defineSample(import.meta.url);
// crawlable HTML generated from the app's own accessibility tree after the build (see src/vite/index.ts)
config.plugins!.push(drawnUiStatic());
export default config;
