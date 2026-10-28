// Line icons (24 × 24, drawn with the current text colour).
const Icon = ({ size = 22, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const Home = p => <Icon {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></Icon>;
export const Clock = p => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
export const User = p => <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></Icon>;
export const Phone = p => <Icon {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></Icon>;
export const Navigate = p => <Icon {...p}><path d="M3 11 21 3l-8 18-2-8z" /></Icon>;
export const Store = p => <Icon {...p}><path d="M4 9h16l-1.5-5h-13z" /><path d="M5 9v11h14V9" /><path d="M9 20v-5h6v5" /></Icon>;
export const Pin = p => <Icon {...p}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></Icon>;
export const Locate = p => <Icon {...p}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></Icon>;
export const Check = p => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const Back = p => <Icon {...p}><path d="M15 5 8 12l7 7" /></Icon>;
export const Chevron = p => <Icon {...p}><path d="m9 5 7 7-7 7" /></Icon>;
export const Bag = p => <Icon {...p}><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></Icon>;
export const Cash = p => <Icon {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 9.5v5M17 9.5v5" /></Icon>;
export const Alert = p => <Icon {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.01" /></Icon>;
export const Logout = p => <Icon {...p}><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></Icon>;
export const Note = p => <Icon {...p}><path d="M5 4h14v12l-4 4H5z" /><path d="M9 9h6M9 13h4" /></Icon>;
export const Bike = p => <Icon {...p}><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16h6l3-7h3M9.5 9H13l2 4" /></Icon>;
export const Route = p => <Icon {...p}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" /></Icon>;
export const Plus = p => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Shield = p => <Icon {...p}><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></Icon>;
export const Star = p => <Icon {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></Icon>;
export const Signal = p => <Icon {...p}><path d="M5 18v-2M9.5 18v-5M14 18V9M18.5 18V5" /></Icon>;
export const Camera = p => <Icon {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Icon>;
export const Barcode = p => <Icon {...p}><path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M17 6v12M20 6v12" /></Icon>;
