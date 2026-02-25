/**
 * Vitest setup - 為單元測試提供 JSDOM 環境與 mock
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
});

global.window = dom.window;
global.document = dom.window.document;
global.alert = () => {};
global.getSupabase = () => null;
