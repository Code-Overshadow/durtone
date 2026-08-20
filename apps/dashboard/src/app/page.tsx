export default function Home() {
  return (
    <main className="min-h-screen bg-[#07111f] px-6 py-8 text-[#e7f0f7] sm:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-between border border-[#254052] bg-[#0b1b2a] p-6 sm:p-10">
        <header className="flex items-center justify-between border-b border-[#254052] pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#67d5c6]">DurtOne</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Control Plane</h1>
          </div>
          <span className="border border-[#376074] px-3 py-2 text-xs uppercase tracking-wider text-[#9bb6c5]">Sprint 1</span>
        </header>
        <section className="grid gap-10 py-16 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <p className="max-w-2xl text-2xl leading-tight text-[#c7d8e3] sm:text-4xl">A base segura para observar, configurar e proteger suas superfícies de aplicação.</p>
            <p className="mt-6 max-w-xl leading-7 text-[#89a5b5]">API, identidade, isolamento por tenant e configuração do DurtWall começam aqui.</p>
          </div>
          <div className="border-l-2 border-[#67d5c6] pl-5 text-sm leading-6 text-[#a9c2ce]">
            <p>API <strong className="text-[#67d5c6]">online</strong></p>
            <p>Auth <strong className="text-[#67d5c6]">Supabase</strong></p>
            <p>Database <strong className="text-[#67d5c6]">PostgreSQL</strong></p>
          </div>
        </section>
        <footer className="border-t border-[#254052] pt-5 text-xs uppercase tracking-wider text-[#668697]">DurtWall / DurtShield / Security Operations</footer>
      </div>
    </main>
  );
}
