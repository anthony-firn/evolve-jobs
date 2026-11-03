export async function loadMatcher(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('WASM matching engine unavailable');
  const {instance} = await WebAssembly.instantiate(await res.arrayBuffer());
  const wasm = instance.exports, encoder = new TextEncoder();
  function contains(text, term) {
    const h=encoder.encode(text), n=encoder.encode(term), hp=wasm.alloc(h.length), np=wasm.alloc(n.length);
    try {
      new Uint8Array(wasm.memory.buffer,hp,h.length).set(h);
      new Uint8Array(wasm.memory.buffer,np,n.length).set(n);
      return wasm.contains(hp,h.length,np,n.length) === 1;
    } finally {wasm.dealloc(hp,h.length);wasm.dealloc(np,n.length);}
  }
  return {contains,salaryMeets:(min,floor)=>wasm.salary_meets(min,floor)===1};
}
