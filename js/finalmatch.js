/* WG.finalmatch — "Final Match" view: Cup Final scouting report + Monte Carlo sim.
 * Self-contained, division-independent (like the old Players view). Southeast = crimson,
 * New York = blue. All tactical notes are the team's own scouting; the simulation is a
 * Poisson model of each side's goals & points, tuned to the data + that scouting.
 */
(function () {
  'use strict';
  var WG = window.WG = window.WG || {};

  // Simulation parameters — Poisson means for goals / points, per side.
  //  Southeast: goal-oriented, faces NY's largely untested goal defence -> more goals.
  //  New York: points team from range (scouting), gambles on goals rarely & less accurately
  //  under pressure -> few goals, many points. Tuned so the spread matches the schedule-
  //  adjusted ratings (NY a marginal favourite).
  var SIM = { seG: 2.4, seP: 5.6, nyG: 1.3, nyP: 9.2 };
  var N = 10000;

  function poisson(lambda) {            // Knuth
    var L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  function runSim(n) {
    var seWin = 0, nyWin = 0, draw = 0;
    var LO = -24, HI = 24, W = 3;
    var nb = Math.floor((HI - LO) / W) + 1;
    var hist = []; for (var b = 0; b < nb; b++) hist.push(0);
    for (var i = 0; i < n; i++) {
      var st = poisson(SIM.seG) * 3 + poisson(SIM.seP);
      var nt = poisson(SIM.nyG) * 3 + poisson(SIM.nyP);
      var m = st - nt;
      if (m > 0) seWin++; else if (m < 0) nyWin++; else draw++;
      var mm = Math.max(LO, Math.min(HI, m));
      hist[Math.floor((mm - LO) / W)]++;
    }
    return { n: n, se: seWin / n, ny: nyWin / n, dr: draw / n, hist: hist, LO: LO, W: W };
  }

  function pct(x) { return Math.round(x * 100); }

  function renderSim(root) {
    var r = runSim(N);
    // win-probability bar
    var wp = root.querySelector('.wpbar');
    wp.innerHTML =
      '<div class="wpseg se" style="width:' + (r.se * 100) + '%">' + (r.se >= .12 ? pct(r.se) + '%' : '') + '</div>' +
      '<div class="wpseg draw" style="width:' + (r.dr * 100) + '%"></div>' +
      '<div class="wpseg ny" style="width:' + (r.ny * 100) + '%">' + (r.ny >= .12 ? pct(r.ny) + '%' : '') + '</div>';
    root.querySelector('.wplabels').innerHTML =
      '<span class="se">Southeast ' + pct(r.se) + '%</span>' +
      '<span class="dr">Draw ' + pct(r.dr) + '%</span>' +
      '<span class="ny">New York ' + pct(r.ny) + '%</span>';
    // histogram
    var max = 1; for (var i = 0; i < r.hist.length; i++) if (r.hist[i] > max) max = r.hist[i];
    var html = '';
    for (var b = 0; b < r.hist.length; b++) {
      var centre = r.LO + b * r.W + r.W / 2;
      var cls = centre > 0 ? 'se' : 'ny';
      var lo = r.LO + b * r.W, hi = lo + r.W;
      var side = centre > 0 ? 'Southeast' : 'New York';
      var t = 'Margin ' + lo + '..' + hi + ' — ' + side + ' — ' + Math.round(r.hist[b] / r.n * 100) + '% of games';
      html += '<div class="hbar ' + cls + '" style="height:' + (r.hist[b] / max * 100) + '%" title="' + t + '"></div>';
    }
    root.querySelector('.hist').innerHTML = html;
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  function template() {
    return '' +
    '<div class="wg-fm">' +

      // VS scoreboard
      '<div class="vs">' +
        '<div class="team se"><div class="crest">SE</div><div class="tname">USGAA Southeast</div><div class="sub">5–1</div></div>' +
        '<div class="mid"><div class="v">VS</div><div class="dt">Cup Final<br>Fri 17 Jul · 12:20</div></div>' +
        '<div class="team ny"><div class="crest">NY</div><div class="tname">New York Camogie</div><div class="sub">8–1 · top seed</div></div>' +
      '</div>' +

      '<p class="thesis"><span class="lead">It’s ours to take</span>' +
        'A coin flip between the two best teams in the division. It won’t be won by one magic bullet — it’ll be won by <b>contesting every ball, taking the chances we get, and never giving their shooters time</b>.</p>' +
      '<div class="verdict">' +
        '<div class="vtile"><div class="k">Matchup</div><div class="big">50/50</div><div class="foot">two best teams</div></div>' +
        '<div class="vtile"><div class="k">Adj. rating</div><div class="big ny">#1 / #2</div><div class="foot">NY +11 · us +10</div></div>' +
        '<div class="vtile"><div class="k">Their game</div><div class="big ny">POINTS</div><div class="foot">not goals — from range</div></div>' +
      '</div>' +

      // PROJECTION + SIM
      '<section><h2 class="fmsec">Projected result — 10,000 simulations</h2><div class="fmcard proj">' +
        '<div class="projline">' +
          '<div class="projteam se"><div class="nm">Southeast</div><div class="sc">2–6</div><div class="tot">12</div></div>' +
          '<div class="projdash">–</div>' +
          '<div class="projteam ny"><div class="nm">New York</div><div class="sc">1–09</div><div class="tot">12</div></div>' +
        '</div>' +
        '<div class="projcap">Typical scoreline — level, decided by a single score. New York edge it more often than not.</div>' +
        '<div class="wp"><div class="wpbar"></div><div class="wplabels"></div></div>' +
        '<div class="histhead"><span class="histtitle">Winning margin — distribution of outcomes</span>' +
          '<button type="button" class="rerun">↻ Re-run</button></div>' +
        '<div class="legend"><span><i class="swatch ny"></i>New York win</span><span><i class="swatch se"></i>Southeast win</span></div>' +
        '<div class="hist"></div>' +
        '<div class="histx"><span>← New York by 24</span><span class="mid">level</span><span>Southeast by 24 →</span></div>' +
        '<div class="histcap">Each run simulates 10,000 finals from a Poisson model of both sides’ goals &amp; points, tuned to the data and the scouting. ~6% finish level → extra time.</div>' +
      '</div></section>' +

      // HOW NEW YORK PLAY
      '<section><h2 class="fmsec">How New York play</h2><div class="fmcard"><div class="plist">' +
        row('🇮🇪','Classic Irish structure.','They look for the cross, the ball down the line, and runners into the back pockets.') +
        row('✋','They hit to hand — constantly.','Leave <b>no ball uncontested</b>; get a body and a stick on every delivery.') +
        row('🎯','They favour the centre.','They look to central options over the wings, and their danger players can point from anywhere between half-field and the 21 if you give them room.') +
        row('🥅','They rarely gamble on goals.','Only #8 and #13 really threaten there — and their goal accuracy dips under pressure.') +
        row('🪝','They ride hooks easily.','But Twin Cities got several clean blocks on them and it clearly rattled them — there’s something psychological there.') +
        row('⏳','They wait on the break.','When ball breaks toward us they lie in wait just in front for a batted-down ball.') +
      '</div></div></section>' +

      // OUR GAME PLAN
      '<section><h2 class="fmsec">Our game plan</h2><div class="fmcard"><div class="keys">' +
        key(1,'Make sure they see you.','Close the space — their shooters punish time from range. Pressure the ball everywhere on the pitch.') +
        key(2,'Block, don’t just hook.','They get around hooks comfortably; clean blocks unsettle them — Twin Cities proved it.') +
        key(3,'Contest every ball to hand.','Nothing uncontested. A stick in every catch, a body on every runner.') +
        key(4,'Don’t bat balls down.','When ball comes our way they’re waiting on the break in front of us — catch it clean or clear it long.') +
        key(5,'Watch the runners.','Track #2’s solo runs up the wing, and don’t let #6 and #8 stack the line for the easy outlet.') +
        key(6,'Take our chances.','Goals are a route in for us — take the green flags that are on, but work the score; don’t force it.') +
      '</div></div></section>' +

      // WATCH LIST
      '<section><h2 class="fmsec">New York — players to watch</h2><div class="fmcard">' +
        '<p class="watchhead">Their main threats and roles, by jersey number:</p><div class="watch">' +
        watch('5','Áine “Anya” Keaney','key','threat','Key threat',
          'Their biggest danger and main scoring threat. An emotional player — get at her early and she can lose the head.') +
        watch('2','Grainne Lavery','','info','Defender',
          'Not a shooter — but breaks out with long solo runs up the wing into the half-forward line. Track her runs; don’t ball-watch.') +
        watch('8','Claire Mahoney','','danger','Danger',
          'Stacks down the line off #6 on puck-outs and in play, and one of the few who’ll go for goal. Carried a hand knock — impact uncertain.') +
        watch('6','Lauren Rodican','','danger','Danger',
          'Pairs with #8 to stack the line for the easy outlet. Went down injured in the semi — watch her.') +
        watch('13','Sinéad Mc Gourty','','danger','Goal threat',
          'With #8, one of the only two who really go for goal — though accuracy drops under pressure.') +
        watch('7','Margaret Glynn','','info','Newer',
          'Good, but likely a newer player. Test her early.') +
      '</div></div></section>' +

      // HEAD TO HEAD
      '<section><h2 class="fmsec">Head to head — the tale of the tape</h2><div class="fmcard">' +
        '<div class="legend"><span><i class="swatch se"></i>USGAA Southeast</span><span><i class="swatch ny"></i>New York</span></div>' +
        metric('Points scored / game','higher is better',[['se','17.5',97,''],['ny','15.8',88,'']]) +
        metric('Goals / game','higher is better',[['se','4.0',100,''],['ny','3.0',75,'']]) +
        metric('Points conceded / game','lower is better',[['se','2.3',74,''],['ny','2.7',87,'']]) +
        metric('Strength rating (schedule-adjusted)','higher is better',[['se','+9.8',88,''],['ny','+11.1',100,'better']]) +
        '<p class="fmnote">Our raw numbers look bigger, but four of our six games were against the two weakest teams. Adjust for who each side actually played and New York edge it by a single point — a genuine toss-up.</p>' +
      '</div></section>' +

      // GOALS CONTEXT (measured)
      '<section><h2 class="fmsec">Goals — an opening, not the whole plan</h2><div class="fmcard"><div class="gcgrid">' +
        '<div class="statbox"><div class="k">Our goal rate</div><div class="hn">4.0<span class="u"> / game</span></div>' +
          '<div class="cap">We back ourselves for green flags — <b>take what’s on</b>, but don’t force them.</div></div>' +
        '<div class="statbox"><div class="k">New York’s only loss</div><div class="hn">2 goals</div>' +
          '<div class="cap">Came when Heartland hit 2 goals. But their light goal-concession partly reflects <b>opponents whose defence wasn’t sorted</b> — and NY themselves seldom go for goals. An opening, not a guarantee.</div></div>' +
      '</div></div></section>' +

      // GOAL TIMING
      '<section><h2 class="fmsec">Tempo — when the goals came</h2><div class="fmcard">' +
        '<p class="fmnote" style="margin:0 0 14px;">Semifinal goal times, on the real 12-minute halves (24-minute game).</p><div class="tl">' +
        tlrow('ny','New York','strike early — both semi goals inside the 8th minute',[[23.3,'6\''],[30,'7\'']],
          'They held Twin Cities scoreless until the 15th minute. Don’t let them get an early run.') +
        tlrow('se','Southeast','score in both halves — and finish hard',[[28.3,'7\''],[45,'11\''],[48.3,'12\''],[56.7,'14\''],[68.3,'16\''],[71.7,'17\'']],
          '<b>Three of our six goals came after half-time.</b> We get stronger — keep the foot down.') +
      '</div></div></section>' +

      // CIRCLE
      '<section><h2 class="fmsec">Why it’s a coin flip — the circle</h2><div class="fmcard"><div class="loop">' +
        loopstep('se','We','beat <b>Heartland</b>','21–6') +
        loopstep('neu','Heartland','beat <b>New York</b>','9–8 — their only loss') +
        loopstep('ny','New York','beat <b>Twin Cities</b>','12–2') +
        loopstep('neu','Twin Cities','beat <b>us</b>','8–7 — our only loss') +
      '</div><p class="fmnote">A full circle — nobody’s unbeatable. The team that troubled us (Twin Cities) is one New York handled easily; the team that beat New York (Heartland) is one we demolished. That’s why the tape says toss-up.</p></div></section>' +

      '<div class="fmfoot">Based on all 36 played Camogie Division 1 games; tactical notes are the team’s own scouting. Simulation is a Poisson model — a guide, not a guarantee.</div>' +

    '</div>';
  }

  function row(ic,title,txt){ return '<div class="prow"><div class="ic">'+ic+'</div><div class="pt"><b>'+title+'</b> '+txt+'</div></div>'; }
  function key(n,title,txt){ return '<div class="key"><div class="n">'+n+'</div><div class="kt"><b>'+esc(title)+'</b> <span class="s">'+txt+'</span></div></div>'; }
  function watch(no,name,rowcls,tagcls,tag,txt){
    return '<div class="wrow '+rowcls+'"><span class="jersey">'+no+'</span><span class="wt"><span class="wn">'+esc(name)+'</span> — '+txt+' <span class="tagf '+tagcls+'">'+esc(tag)+'</span></span></div>';
  }
  function metric(name,hint,rows){
    var h='<div class="metric"><div class="mlabel"><span class="mname">'+esc(name)+'</span><span class="mhint">'+esc(hint)+'</span></div>';
    rows.forEach(function(r){
      h+='<div class="barrow"><span class="who '+r[0]+'">'+r[0].toUpperCase()+'</span><div class="track"><div class="fill '+r[0]+'" style="width:'+r[2]+'%"></div></div><span class="val'+(r[3]==='better'?' better':'')+'">'+r[1]+'</span></div>';
    });
    return h+'</div>';
  }
  function tlrow(cls,nm,desc,dots,foot){
    var h='<div class="row"><div class="rowhead"><span class="nm '+cls+'">'+nm+'</span><span class="desc">'+desc+'</span></div><div class="axis"><div class="base"></div><div class="htline"></div>';
    dots.forEach(function(d){ h+='<div class="goaldot '+cls+'" style="left:'+d[0]+'%" title="Goal, '+d[1]+'">G</div>'; });
    h+='<div class="tick" style="left:0%">0\'</div><div class="tick" style="left:50%">HT · 12\'</div><div class="tick" style="left:100%">24\'</div></div>';
    return h+'<div class="foot">'+foot+'</div></div>';
  }
  function loopstep(cls,who,beat,sc){
    return '<div class="loopstep"><span class="chip '+cls+'">'+esc(who)+'</span><span class="beat">'+beat+' <span class="sc">'+esc(sc)+'</span></span></div>';
  }

  function render(container) {
    if (!container) return;
    if (container.getAttribute('data-fm') !== '1') {
      container.innerHTML = template();
      container.setAttribute('data-fm', '1');
      var root = container.querySelector('.wg-fm');
      renderSim(root);
      var btn = container.querySelector('.rerun');
      if (btn) btn.addEventListener('click', function () { renderSim(root); });
    }
  }

  WG.finalmatch = { render: render };
})();
