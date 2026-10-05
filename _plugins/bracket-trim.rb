# 본문의 《》「」〈〉는 한쪽이 비어 있어 글자 사이가 벌어져 보이므로,
# 부호를 span(.bo 여는 쪽, .bc 닫는 쪽)으로 감싸 CSS로 빈 쪽을 접는다.
# 레이아웃이 입혀진 최종 HTML에서 본문(<div class="content"> ~ </article>)의 글자에만 적용한다.
# RSS 등 다른 출력에는 영향이 없다. 코드(<pre>, <code>) 안은 건드리지 않는다.
module BracketTrim
  OPEN = /[《「〈]/
  CLOSE = /[》」〉]/
  START = '<div class="content">'
  STOP = '</article>'

  def self.wrap(html)
    skip = 0
    html.split(/(<[^>]+>)/).map do |part|
      if part.start_with?("<")
        skip += 1 if part =~ /\A<(pre|code)[\s>]/
        skip -= 1 if part =~ /\A<\/(pre|code)>/
        part
      elsif skip > 0
        part
      else
        part.gsub(OPEN) { |c| %(<span class="bo">#{c}</span>) }
            .gsub(CLOSE) { |c| %(<span class="bc">#{c}</span>) }
      end
    end.join
  end

  def self.apply(output)
    from = output.index(START)
    return output unless from
    to = output.index(STOP, from) || output.length
    output[0...from] + wrap(output[from...to]) + output[to..]
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |doc|
  next unless doc.output_ext == ".html"
  doc.output = BracketTrim.apply(doc.output)
end
