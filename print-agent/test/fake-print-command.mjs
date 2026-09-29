import { readFile } from 'node:fs/promises'

const [file,printer,copies,duplex,color,fitMode,paperSource]=process.argv.slice(2)
if(!file||!printer||!copies)process.exit(2)
const data=await readFile(file)
if(file.endsWith('.pdf')){
  if(data.subarray(0,5).toString('ascii')!=='%PDF-')process.exit(3)
}else{
  if(!data.toString('utf8').includes('command-adapter-smoke'))process.exit(3)
}
if(printer!=='fake-printer')process.exit(4)
if(copies!=='2')process.exit(5)
if(duplex!=='LONG_EDGE')process.exit(6)
if(color!=='MONOCHROME')process.exit(7)
if(fitMode!=='FIT')process.exit(8)
if(paperSource!=='Tray 2')process.exit(9)
process.stdout.write('fake print command accepted')
