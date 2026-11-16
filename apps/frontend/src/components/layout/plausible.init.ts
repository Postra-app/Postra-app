// What Plausible is told about a page: where in the app, never which one.
// Its script sent the whole address on every view, so the password reset
// link (/auth/forgot/<token>, good until used), the activation code, the
// invitation that lets its holder connect a channel, the id that opens a
// post's public preview and the code and state of an OAuth return all left
// for a third party's dashboard. The script lets a page change the request
// before it goes: ids and tokens in the path become ":id", the query is cut
// down to campaign tags, and a referrer on this site gets the same.
//
// Kept as text: it runs inline, before any bundle, with the page's nonce.
export const PLAUSIBLE_CLEAN_URL = `function(u){
  try{
    var a=new URL(u,location.href);
    if(a.origin!==location.origin)return u;
    var secret=/^\\/(auth\\/(forgot|activate)|connect\\/[^/]+|join|p)\\/[^/]+/;
    var path=a.pathname.split('/').map(function(s,i,all){
      if(!s)return s;
      if(s.length>24||(/\\d/.test(s)&&s.length>=8))return ':id';
      return s;
    }).join('/');
    if(secret.test(a.pathname)){
      var parts=path.split('/');
      parts[parts.length-1]=':id';
      path=parts.join('/');
    }
    var keep=[];
    a.searchParams.forEach(function(v,k){
      if(/^(utm_(source|medium|campaign|content|term)|ref|source)$/.test(k))keep.push(encodeURIComponent(k)+'='+encodeURIComponent(v));
    });
    return a.origin+path+(keep.length?'?'+keep.join('&'):'');
  }catch(e){return location.origin+'/'}
}`;

export const PLAUSIBLE_INIT = `window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};(function(){var clean=${PLAUSIBLE_CLEAN_URL};plausible.init({transformRequest:function(p){if(p){if(p.u)p.u=clean(p.u);if(p.r)p.r=clean(p.r)}return p}})})()`;
