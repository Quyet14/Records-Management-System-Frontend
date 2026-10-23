const test=require('node:test');
const assert=require('node:assert/strict');
const stats=require('../assets/js/admin-statistics.js');
const options=stats.parameters(2026,5,100);
function fixture(path){
 const u=new URL(path,'https://example.test');
 switch(u.pathname){
 case '/stats/overview':return {totalDocuments:49,totalUsers:900,totalDepartments:18,storedSizeBytes:100,byStatus:[{status:'pending',count:49,totalBytes:100},{status:'destroyed',count:3,totalBytes:0}]};
 case '/stats/by-department':return Array.from({length:40},(_,i)=>({departmentName:'Khoa '+i,totalDocuments:49,totalBytes:100,storedCount:0,pendingCount:49,rejectedCount:0}));
 case '/stats/by-document-type':return {unclassifiedCount:2,byType:Array.from({length:30},()=>({totalDocuments:49,totalBytes:100,storedCount:0}))};
 case '/stats/by-year':return {year:2026,monthly:Array.from({length:12},(_,i)=>({month:i+1,totalDocuments:0,totalBytes:0}))};
 case '/stats/by-classification':return [{classificationValue:'timed',count:52,totalBytes:100}];
 case '/stats/storage-growth':return [];
 case '/stats/top-uploaders':return Array.from({length:100},()=>({totalDocuments:2,totalBytes:100}));
 case '/stats/review-progress':return {totalOldDocuments:0,completed:0,remaining:0,completionRate:100,byStatus:{}};
 case '/stats/expiring-soon':return {withinDays:1825,total:0,data:[]};
 default:throw Error('Unexpected endpoint');
 }
}
test('admin reports fetch nine aggregates and retain complete rows and destroyed counts',async()=>{
 const calls=[];const result=await stats.load(async path=>{calls.push(path);return fixture(path);},options);
 assert.equal(calls.length,9);assert.ok(calls.every(path=>path.startsWith('/stats/')));
 assert.ok(Object.values(result).every(entry=>entry.status==='fulfilled'));
 assert.equal(result.overview.value.byStatus[0].count,49);
 assert.equal(result.overview.value.byStatus[1].count,3);
 assert.equal(result.departments.value.length,40);assert.equal(result.types.value.byType.length,30);assert.equal(result.uploaders.value.length,100);
 assert.deepEqual(calls.filter(path=>path.includes('year=')),['/stats/by-year?year=2026']);
});
test('admin year refresh only requests monthly aggregates',async()=>{
 const calls=[];const result=await stats.load(async path=>{calls.push(path);return fixture(path);},options,['monthly']);
 assert.deepEqual(calls,['/stats/by-year?year=2026']);assert.deepEqual(Object.keys(result),['monthly']);
});
test('one failed aggregate is isolated without fallback or invented zero values',async()=>{
 const calls=[];const result=await stats.load(async path=>{calls.push(path);if(path==='/stats/overview')throw Error('Forbidden');return fixture(path);},options);
 assert.equal(result.overview.status,'rejected');assert.equal(result.overview.value,undefined);assert.equal(result.monthly.status,'fulfilled');assert.equal(calls.length,9);
});
test('invalid filters and malformed aggregate payloads are rejected',async()=>{
 for(const args of [[2026,0,10],[2026,51,10],[2026,5,20],[2026.5,5,10],['',5,10]])assert.throws(()=>stats.parameters(...args));
 assert.throws(()=>stats.validate('overview',{totalDocuments:20},options));
 assert.throws(()=>stats.validate('monthly',{year:2025,monthly:fixture('/stats/by-year').monthly},options));
 assert.throws(()=>stats.validate('expiry',{withinDays:1825,total:49,data:[]},options));
 assert.throws(()=>stats.validate('growth',[{year:2026,month:13,addedBytes:0,addedDocs:0,cumulativeBytes:0,cumulativeDocs:0}],options));
 await assert.rejects(()=>stats.load(async()=>[],options,['documents']));
});
