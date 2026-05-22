/* TabStrip — segmented control between hero + filter row.
   - Two pill tabs: "Polls" (default) and "Posts"
   - Active = solid green; inactive = outlined
   - Tab content underneath slide-fades horizontally on switch
   - Mobile: full-width segmented, 44pt min hit targets
*/

function TabStrip({ active, onChange }) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Feed">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'polls'}
        className={`tabstrip__tab ${active === 'polls' ? 'is-active' : ''}`}
        onClick={() => onChange('polls')}>
        Polls
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'posts'}
        className={`tabstrip__tab ${active === 'posts' ? 'is-active' : ''}`}
        onClick={() => onChange('posts')}>
        Posts
      </button>
    </div>
  );
}

/* TabContent — slide-fade transition shell.
   When `tabKey` changes, fade-out + slide-left the old, fade-in + slide-right
   the new. ~280ms each side.
*/
function TabContent({ tabKey, children }) {
  const [displayedKey, setDisplayedKey] = React.useState(tabKey);
  const [displayedChildren, setDisplayedChildren] = React.useState(children);
  const [phase, setPhase] = React.useState('idle'); // 'out' | 'in' | 'idle'

  React.useEffect(() => {
    if (tabKey === displayedKey) {
      setDisplayedChildren(children);
      return;
    }
    setPhase('out');
    const t1 = setTimeout(() => {
      setDisplayedKey(tabKey);
      setDisplayedChildren(children);
      setPhase('in');
      const t2 = setTimeout(() => setPhase('idle'), 30);
      return () => clearTimeout(t2);
    }, 240);
    return () => clearTimeout(t1);
  }, [tabKey, children, displayedKey]);

  return (
    <div className={`tabcontent tabcontent--${phase}`}>
      {displayedChildren}
    </div>
  );
}

window.TabStrip = TabStrip;
window.TabContent = TabContent;
