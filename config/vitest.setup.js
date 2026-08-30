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

// React 用這個旗標判斷 act() 是否在測試環境中被呼叫；沒設會對每次 act 印出警告
global.IS_REACT_ACT_ENVIRONMENT = true;
