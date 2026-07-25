interface Props {
  title: string;
  /** Doc filename under docs/pages/, e.g. "ticket-queue". */
  spec?: string;
}

// Stand-in for a section whose screens haven't been implemented yet — every
// top-level route resolves so navigation is complete from day one.
export function PlaceholderPage({ title, spec }: Props) {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="placeholder">
        <div className="big">{title} isn’t built yet</div>
        This section is specified and wireframed
        {spec ? (
          <>
            {" "}
            (<code>docs/pages/{spec}.html</code>)
          </>
        ) : null}
        {" "}— implementation is coming in a later increment.
      </div>
    </div>
  );
}
