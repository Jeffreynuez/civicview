/* StateDropdown — opens from the "States" chip.
   - Scrollable list of 51 entries (50 states + DC)
   - Fade gradients at top + bottom of scroll area
   - Top fade only appears once the user has scrolled away from top
   - Bottom fade always visible until end of list
   - Single-select within dropdown
   - Mobile (≤600 container): full-width sheet that pushes content below
*/

function StateDropdown({ selected, onSelect, onClose, anchor = 'inline' }) {
  const G = window.PollsGlyph;
  const scrollRef = React.useRef(null);
  const [scrolled, setScrolled] = React.useState(false);
  const [atEnd, setAtEnd] = React.useState(false);

  const handleScroll = React.useCallback((e) => {
    const el = e.target;
    setScrolled(el.scrollTop > 6);
    setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 6);
  }, []);

  return (
    <div className={`states-dd states-dd--${anchor}`} role="listbox" aria-label="Filter by state">
      <div className="states-dd__head">
        <span className="states-dd__title">Filter by state</span>
        {selected && (
          <button type="button" className="states-dd__clear" onClick={() => onSelect(null)}>
            Clear
          </button>
        )}
      </div>

      <div className={`states-dd__scroll ${scrolled ? 'is-scrolled' : ''} ${atEnd ? 'is-end' : ''}`}>
        {/* top fade — only when scrolled */}
        <div className="states-dd__fade states-dd__fade--top" aria-hidden="true" />
        <div className="states-dd__list" ref={scrollRef} onScroll={handleScroll}>
          {window.US_STATES.map(([abbr, name]) => (
            <button
              key={abbr}
              type="button"
              role="option"
              aria-selected={selected === abbr}
              className={`states-dd__item ${selected === abbr ? 'is-selected' : ''}`}
              onClick={() => { onSelect(abbr); onClose && onClose(); }}>
              <span className="states-dd__abbr cl-num">{abbr}</span>
              <span className="states-dd__name">{name}</span>
              {selected === abbr && <span className="states-dd__check">✓</span>}
            </button>
          ))}
        </div>
        {/* bottom fade — always visible until at end */}
        <div className="states-dd__fade states-dd__fade--bot" aria-hidden="true" />
      </div>
    </div>
  );
}

window.StateDropdown = StateDropdown;
