بیر — Bîr
==========

پلاتفۆرمێکی بەتاڵی فلاشکارد بە ڕووکاری کوردی، ئینگلیزی و عەرەبی.
هیچ کارت یان وێنەی خوێندنی پێشوەختەی تێدا نییە.

دەستپێکردن
-----------
فۆڵدەری پڕۆژەکە بکەرەوە و دوو کرتە لە index.html بکە.
لە پەڕەی سەرەکی «هاوردەکردنی فایل» هەڵبژێرە بۆ TXT، TSV یان CSV.
پێش هاوردەکردن، نموونەی کارت و ستوونی پرسیار و وەڵام بپشکنە.
یان «دەکێک دروست بکە» هەڵبژێرە و کارتەکانی خۆت بە دەست زیاد بکە.

بۆ Anki / APKG
--------------
لە ناو فۆڵدەری پڕۆژەکە ئەم فەرمانە جێبەجێ بکە:
    python server.py --port 64008
پاشان http://127.0.0.1:64008/ بکەرەوە و سێرڤەرەکە کارا بهێڵەوە.

Python 3.10 یان نوێتر پێویستە. APKG لە ویندۆز پێویستی بە PowerShell 7
(pwsh) و Ankiی دامەزراو بە ژینگەی Python 3.13 و python313.dll هەیە.
یاریدەدەرەکە لەگەڵ Anki 26.9.3 تاقی کراوەتەوە. ڕێڕەوی بنەڕەتی:
    %LOCALAPPDATA%\Programs\Anki
Anki لەناو پڕۆژەکەدا نییە. مێژووی خوێندنی Anki هاوردە ناکرێت.

پاراستنی داتاکانت
-----------------
داتا لە هەمان وێبگەڕ پاشەکەوت دەکرێت؛ ئەکاونت و هاوکاتکردنی هەور نییە.
ئەم وەشانە پاشەکەوتکردنی جیاوازی هەیە؛ داتای وەشانی پێشووتر خۆکارانە
ناگەڕێنێتەوە. هەمان وێبگەڕ و ناونیشان بەکاربهێنە.

لە ڕێکخستنەکان کۆپیی JSON دابەزێنە. وێنەکان لەناو JSONدا نین؛ فۆڵدەری
تەواوی پڕۆژەکە بە media/ و وێنە هاوردەکراوەکانەوە لەگەڵی بپارێزە.
media/.gitkeep فۆڵدەری بەتاڵی وێنەکان لە پڕۆژەدا دەهێڵێتەوە.

ئەمە پلاتفۆرمێکی وێبە؛ APK یان IPAی مۆبایل نییە.
ڕێنمایی زیاتر لە README.md و docs/UPLOAD_TO_GITHUB_SORANI.md هەیە.
بۆ تاقیکردنەوەکان بە Node.js 24: npm test

ENGLISH
-------
Empty flashcard platform: open index.html to create decks/cards or import
TXT, TSV and CSV. For APKG, run the local Python server and use the installed
Windows Anki Python 3.13 runtime plus PowerShell 7 described above.
Cards and progress are stored in this browser using separate app storage.
There is no account or cloud sync. Export JSON from Settings and also keep
the complete app folder, including imported media, because JSON has no images.
