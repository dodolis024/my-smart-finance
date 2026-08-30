import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 命令列工具使用說明。
 *
 * 指令本身不放進 locales：兩種語言共用同一份，避免翻譯時把指令改壞。
 * 只有給人看的描述才走 t()。
 */
const PACKAGE_NAME = 'my-smart-finance-cli';

const INSTALL_CMD = `npm install -g ${PACKAGE_NAME}`;
const UPDATE_CMD = `npm update -g ${PACKAGE_NAME}`;
const LOGIN_CMD = 'finance login';

const COMMAND_ROWS = [
  { cmd: 'finance list', key: 'list' },
  { cmd: 'finance summary', key: 'summary' },
  { cmd: 'finance streak', key: 'streak' },
  { cmd: 'finance accounts', key: 'accounts' },
  { cmd: 'finance categories', key: 'categories' },
  { cmd: 'finance edit <id> --amount 200', key: 'edit' },
  { cmd: 'finance rm <id>', key: 'remove' },
  { cmd: 'finance help', key: 'help' },
];

const TROUBLE_ROWS = ['stuck', 'port', 'ssh', 'session'];

const ChevronRight = ({ isOpen }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    style={{ width: 14, height: 14, flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
  >
    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
  </svg>
);

const IconCopy = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
  </svg>
);

const IconCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

function CodeBlock({ code }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 瀏覽器擋下剪貼簿存取時不做事，使用者仍可自行選取文字
    }
  };

  const copyLabel = copied ? t('settings.guide.copied') : t('settings.guide.copy');

  return (
    <div className="guide-code">
      <pre className="guide-code__text">{code}</pre>
      <button type="button" className="guide-code__copy" onClick={copy} aria-label={copyLabel} title={copyLabel}>
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}

function Step({ index, title, desc, children }) {
  return (
    <li className="guide-step">
      <div className="guide-step__head">
        <span className="guide-step__index" aria-hidden="true">{index}</span>
        <div>
          <h4 className="guide-step__title">{title}</h4>
          <p className="guide-step__desc">{desc}</p>
        </div>
      </div>
      {children}
    </li>
  );
}

function Collapsible({ title, isOpen, onToggle, children }) {
  return (
    <div className={`guide-collapsible${isOpen ? ' is-open' : ''}`}>
      <button type="button" className="guide-collapsible__head" onClick={onToggle} aria-expanded={isOpen}>
        <ChevronRight isOpen={isOpen} />
        <span>{title}</span>
      </button>
      {isOpen && <div className="guide-collapsible__body">{children}</div>}
    </div>
  );
}

export default function GuidePanel() {
  const { t } = useLanguage();
  const [open, setOpen] = useState({ commands: false, trouble: false, scope: false });
  const toggle = (key) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">{t('settings.guide.title')}</h3>
      <p className="guide-intro">{t('settings.guide.intro')}</p>

      <ol className="guide-steps">
        <Step
          index="1"
          title={t('settings.guide.steps.install.title')}
          desc={t('settings.guide.steps.install.desc')}
        >
          <CodeBlock code={INSTALL_CMD} />
          <p className="guide-step__hint">{t('settings.guide.steps.install.update')}</p>
          <CodeBlock code={UPDATE_CMD} />
        </Step>

        <Step
          index="2"
          title={t('settings.guide.steps.login.title')}
          desc={t('settings.guide.steps.login.desc')}
        >
          <CodeBlock code={LOGIN_CMD} />
        </Step>

        <Step
          index="3"
          title={t('settings.guide.steps.add.title')}
          desc={t('settings.guide.steps.add.desc')}
        >
          <CodeBlock code={t('settings.guide.steps.add.example')} />
        </Step>

        {/* 能執行終端機指令的 AI 助理不需要額外整合，直接請它打指令就好 */}
        <Step
          index="4"
          title={t('settings.guide.steps.agent.title')}
          desc={t('settings.guide.steps.agent.desc')}
        >
          <p className="guide-step__hint">{t('settings.guide.steps.agent.hint')}</p>
          <CodeBlock code={t('settings.guide.steps.agent.example')} />
        </Step>
      </ol>

      <div className="guide-advanced">
        <Collapsible
          title={t('settings.guide.advanced.commands.title')}
          isOpen={open.commands}
          onToggle={() => toggle('commands')}
        >
          <dl className="guide-cmdlist">
            {COMMAND_ROWS.map(({ cmd, key }) => (
              <div className="guide-cmdlist__row" key={key}>
                <dt><code>{cmd}</code></dt>
                <dd>{t(`settings.guide.advanced.commands.${key}`)}</dd>
              </div>
            ))}
          </dl>
        </Collapsible>

        <Collapsible
          title={t('settings.guide.advanced.trouble.title')}
          isOpen={open.trouble}
          onToggle={() => toggle('trouble')}
        >
          <dl className="guide-cmdlist">
            {TROUBLE_ROWS.map((key) => (
              <div className="guide-cmdlist__row guide-cmdlist__row--stack" key={key}>
                <dt>{t(`settings.guide.advanced.trouble.${key}.q`)}</dt>
                <dd>{t(`settings.guide.advanced.trouble.${key}.a`)}</dd>
              </div>
            ))}
          </dl>
        </Collapsible>

        <Collapsible
          title={t('settings.guide.advanced.scope.title')}
          isOpen={open.scope}
          onToggle={() => toggle('scope')}
        >
          <p className="guide-scope__lead">{t('settings.guide.advanced.scope.canTitle')}</p>
          <p className="guide-scope__text">{t('settings.guide.advanced.scope.can')}</p>
          <p className="guide-scope__lead">{t('settings.guide.advanced.scope.cannotTitle')}</p>
          <p className="guide-scope__text">{t('settings.guide.advanced.scope.cannot')}</p>
          <p className="guide-scope__lead">{t('settings.guide.advanced.scope.safetyTitle')}</p>
          <p className="guide-scope__text">{t('settings.guide.advanced.scope.safety')}</p>
        </Collapsible>
      </div>
    </div>
  );
}
