export default function IconPicker() {
  const tabs = [
    {
      name: "Audio Cut",
      color: "bg-emerald-50 border-emerald-200",
      headerColor: "bg-emerald-500",
      icons: [
        {
          id: "A",
          label: "Scissors + Wave",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
            </svg>
          ),
        },
        {
          id: "B",
          label: "Waveform Cut",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l2 5 2-8 2 8 2-5v13" />
              <line x1="3" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1="19" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 2" />
            </svg>
          ),
        },
        {
          id: "C",
          label: "Music + Scissors",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13" />
              <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth={2} />
              <circle cx="18" cy="16" r="2" stroke="currentColor" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.5 13.5l2.5 2.5m0-2.5l-2.5 2.5" />
            </svg>
          ),
        },
        {
          id: "D",
          label: "Knife Cut",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 19l9-9m0 0l4-4a2.828 2.828 0 114 4l-4 4m-4-4l-2 2" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-3 9" />
            </svg>
          ),
        },
        {
          id: "E",
          label: "Trim Bars",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="8" width="18" height="8" rx="2" stroke="currentColor" strokeWidth={2} />
              <line x1="9" y1="6" x2="9" y2="18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1="15" y1="6" x2="15" y2="18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ),
        },
        {
          id: "F",
          label: "Blade",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20L20 4" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20l4-2 1-4" />
              <circle cx="19" cy="5" r="2" stroke="currentColor" strokeWidth={2} />
            </svg>
          ),
        },
      ],
    },
    {
      name: "Audio +-",
      color: "bg-violet-50 border-violet-200",
      headerColor: "bg-violet-500",
      icons: [
        {
          id: "A",
          label: "Speed Meter",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4M6.3 17.7l-1.4-1.4M17.7 17.7l1.4-1.4" />
            </svg>
          ),
        },
        {
          id: "B",
          label: "Waveform +/-",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l2 5 2-8 2 8 2-5v13" />
              <text x="17" y="8" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold">+</text>
              <text x="17" y="16" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold">-</text>
            </svg>
          ),
        },
        {
          id: "C",
          label: "Music Note +/-",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13" />
              <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth={2} />
              <circle cx="18" cy="16" r="2" stroke="currentColor" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10h2m-1-1v2" />
            </svg>
          ),
        },
        {
          id: "D",
          label: "Gauge",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12a9 9 0 1118 0" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12l-3-5" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 16h1m11 0h-1m-5-9V6" />
            </svg>
          ),
        },
        {
          id: "E",
          label: "Rabbit Fast",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          ),
        },
        {
          id: "F",
          label: "Sliders",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <circle cx="8" cy="6" r="2" fill="white" stroke="currentColor" strokeWidth={2} />
              <circle cx="16" cy="12" r="2" fill="white" stroke="currentColor" strokeWidth={2} />
              <circle cx="10" cy="18" r="2" fill="white" stroke="currentColor" strokeWidth={2} />
            </svg>
          ),
        },
      ],
    },
    {
      name: "Audio Spliter",
      color: "bg-blue-50 border-blue-200",
      headerColor: "bg-blue-500",
      icons: [
        {
          id: "A",
          label: "Fork Split",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v7m0 0l-4 4m4-4l4 4m-8 7a2 2 0 100-4 2 2 0 000 4zm8 0a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          ),
        },
        {
          id: "B",
          label: "Wave Split",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h4m0 0V6l2 3 2-5 2 5 2-3v6m0 0h4" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12l-3 6m11-6l3 6" />
            </svg>
          ),
        },
        {
          id: "C",
          label: "Scissors Split",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="3 2" />
              <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth={2} />
              <circle cx="5" cy="18" r="2" stroke="currentColor" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6l5 6M7 18l5-6" />
            </svg>
          ),
        },
        {
          id: "D",
          label: "SRT Lines",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 000 4h6a2 2 0 000-4M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              <line x1="9" y1="14" x2="15" y2="14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1="9" y1="17" x2="13" y2="17" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ),
        },
        {
          id: "E",
          label: "Speaker Split",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" stroke="currentColor" strokeWidth={2} fill="none" strokeLinejoin="round" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.54 8.46a5 5 0 010 7.07" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.07 4.93a10 10 0 010 14.14" />
            </svg>
          ),
        },
        {
          id: "F",
          label: "Grid Split",
          svg: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="8" height="5" rx="1" stroke="currentColor" strokeWidth={2} />
              <rect x="13" y="3" width="8" height="5" rx="1" stroke="currentColor" strokeWidth={2} />
              <rect x="3" y="12" width="18" height="9" rx="1" stroke="currentColor" strokeWidth={2} />
              <line x1="12" y1="3" x2="12" y2="8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeDasharray="2 1" />
            </svg>
          ),
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col gap-6">
      <h1 className="text-center text-gray-700 font-semibold text-lg">Tab Icon Options — Pick one per tab</h1>
      {tabs.map((tab) => (
        <div key={tab.name} className={`rounded-xl border-2 ${tab.color} overflow-hidden shadow-sm`}>
          <div className={`${tab.headerColor} px-4 py-2`}>
            <span className="text-white font-semibold text-sm">{tab.name}</span>
          </div>
          <div className="p-4 grid grid-cols-6 gap-3">
            {tab.icons.map((icon) => (
              <div
                key={icon.id}
                className="flex flex-col items-center gap-2 bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700">
                  {icon.svg}
                </div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{icon.id}</span>
                <span className="text-[10px] text-gray-400 text-center leading-tight">{icon.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-center text-gray-400 text-xs">e.g. Audio Cut → B, Audio +- → F, Audio Spliter → A</p>
    </div>
  );
}
