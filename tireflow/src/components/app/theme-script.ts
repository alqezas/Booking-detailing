/** Runs in <head> before paint so the page never flashes the wrong theme. */
export const themeScript =
  "try{var t=localStorage.getItem('tf-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}";
