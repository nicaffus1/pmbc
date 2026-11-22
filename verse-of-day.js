// Daily KJV Scripture. A fixed collection works even without internet.
const VERSES=[
 [
  "Psalm 119:105",
  "Thy word is a lamp unto my feet, and a light unto my path."
 ],
 [
  "Proverbs 3:5",
  "Trust in the LORD with all thine heart; and lean not unto thine own understanding."
 ],
 [
  "Proverbs 3:6",
  "In all thy ways acknowledge him, and he shall direct thy paths."
 ],
 [
  "Psalm 46:1",
  "God is our refuge and strength, a very present help in trouble."
 ],
 [
  "Psalm 118:24",
  "This is the day which the LORD hath made; we will rejoice and be glad in it."
 ],
 [
  "Psalm 23:1",
  "The LORD is my shepherd; I shall not want."
 ],
 [
  "Psalm 34:8",
  "O taste and see that the LORD is good: blessed is the man that trusteth in him."
 ],
 [
  "Isaiah 40:31",
  "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint."
 ],
 [
  "Isaiah 41:10",
  "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness."
 ],
 [
  "Matthew 5:16",
  "Let your light so shine before men, that they may see your good works, and glorify your Father which is in heaven."
 ],
 [
  "Matthew 6:33",
  "But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you."
 ],
 [
  "Matthew 11:28",
  "Come unto me, all ye that labour and are heavy laden, and I will give you rest."
 ],
 [
  "Luke 1:37",
  "For with God nothing shall be impossible."
 ],
 [
  "John 3:16",
  "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
 ],
 [
  "John 8:12",
  "Then spake Jesus again unto them, saying, I am the light of the world: he that followeth me shall not walk in darkness, but shall have the light of life."
 ],
 [
  "John 14:6",
  "Jesus saith unto him, I am the way, the truth, and the life: no man cometh unto the Father, but by me."
 ],
 [
  "Romans 8:28",
  "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."
 ],
 [
  "Romans 12:12",
  "Rejoicing in hope; patient in tribulation; continuing instant in prayer;"
 ],
 [
  "Philippians 4:13",
  "I can do all things through Christ which strengtheneth me."
 ],
 [
  "Philippians 4:6",
  "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God."
 ],
 [
  "1 Thessalonians 5:17",
  "Pray without ceasing."
 ],
 [
  "1 Peter 5:7",
  "Casting all your care upon him; for he careth for you."
 ],
 [
  "James 1:5",
  "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him."
 ],
 [
  "Psalm 37:4",
  "Delight thyself also in the LORD; and he shall give thee the desires of thine heart."
 ],
 [
  "Jeremiah 33:3",
  "Call unto me, and I will answer thee, and shew thee great and mighty things, which thou knowest not."
 ],
 [
  "Micah 6:8",
  "He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?"
 ],
 [
  "2 Timothy 3:16",
  "All scripture is given by inspiration of God, and is profitable for doctrine, for reproof, for correction, for instruction in righteousness:"
 ],
 [
  "Hebrews 11:1",
  "Now faith is the substance of things hoped for, the evidence of things not seen."
 ],
 [
  "1 John 4:19",
  "We love him, because he first loved us."
 ],
 [
  "Psalm 100:5",
  "For the LORD is good; his mercy is everlasting; and his truth endureth to all generations."
 ],
 [
  "Joshua 1:9",
  "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest."
 ]
];
const TZ="America/Chicago";
let interval=null,lastDate="";
function centralDate(){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const get=key=>parts.find(p=>p.type===key)?.value;
 return get("year")+"-"+get("month")+"-"+get("day");
}
function verseForDate(day){
 // UTC calendar-day counter gives the same passage to all viewers each day.
 const number=Math.floor(Date.parse(day+"T00:00:00Z")/86400000);
 return VERSES[((number%VERSES.length)+VERSES.length)%VERSES.length];
}
function escapeHTML(x){return String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function updateVerse(){
 const target=document.getElementById("daily-verse");if(!target)return;
 const today=centralDate();if(today===lastDate&&target.dataset.date===today)return;
 lastDate=today;const [ref,text]=verseForDate(today);
 const formatted=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"long",day:"numeric"}).format(new Date(today+"T12:00:00Z"));
 const link="https://www.biblegateway.com/passage/?search="+encodeURIComponent(ref)+"&version=KJV";
 target.dataset.date=today;
 target.innerHTML='<div class="daily-verse-top"><span>VERSE OF THE DAY</span><time datetime="'+today+'">'+escapeHTML(formatted)+'</time></div>'+
  '<blockquote>“'+escapeHTML(text)+'”</blockquote>'+
  '<a href="'+link+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(ref)+' <span>KJV ↗</span></a>';
}
export function mountDailyVerse(){
 unmountDailyVerse();lastDate="";updateVerse();
 interval=setInterval(updateVerse,60000);
}
export function unmountDailyVerse(){if(interval!==null){clearInterval(interval);interval=null;}}
