---
title: TrieMap实现
published: 2025-07-19
description: ''
image: ''
tags: [TrieMap, 数据结构, 算法]
category: '数据结构与算法'
draft: false 
lang: ''
---

<https://labuladong.online/algo/data-structure/trie-implement/#trieset-%E7%9A%84%E5%AE%9E%E7%8E%B0>

<https://labuladong.online/algo/data-structure-basic/trie-map-basic/>
**TrieMap 是什么？**
Tire树又称字典树/前缀树，具有如下特点

根节点不包含字符 除根节点外每个节点只包含一个字符
树的每一个路径都是一个字符串
每个节点的子节点包含的字符都不相同

简单来说，**TrieMap 就是一个将 Trie（前缀树）的数据结构与 Map（映射）的功能结合起来的集合。** 它不仅仅是一个键值对的存储器，更是一个能够高效地处理与字符串（或任何序列）键相关的各种操作的强大工具。

**核心思想：Trie + Map**

1. **Trie（前缀树）作为底层结构：**
    * Trie 的核心思想是利用键的公共前缀来共享节点，从而节省空间和提高查找效率。
    * 每个节点通常代表键的一个字符或序列中的一个元素。
    * 从根节点到任意一个节点的路径，代表了一个前缀。

2. **Map 的功能扩展：**
    * 在 Trie 的基础上，将值 "挂载" 到 Trie 的特定节点上。
    * 通常，当一个键的完整路径在一个 Trie 节点处结束时，这个节点会包含与该键关联的值。
    * 一个节点可以有多个子节点（对应不同的下一个字符），也可以存储一个值（表示该前缀本身就是一个完整的键）。

**TrieMap 的结构和工作原理**

* **节点（Node）：** TrieMap 的基本构建单元。每个节点至少包含：
  * **子节点指针（Children）：** 通常是一个 Map 或数组，用于存储指向下一个字符/元素的子节点的引用。例如，`Map<Character, Node>` 或 `Node[26]` (针对英文字母)。
  * **值（Value）：** 一个可选的字段，如果当前节点代表一个完整的键的结束，则该字段存储与该键关联的值。如果一个节点只是一个前缀，但不是一个完整的键，则此字段可能为 `null` 或表示没有值。
  * **isEndOfWord/isKey (布尔值):** 一个标记，指示当前节点是否代表一个完整的键的结束。这在区分一个前缀 vs. 一个完整的键时非常有用。

* **插入（`put(key, value)`）：**
    1. 从根节点开始。
    2. 遍历键的每个字符。对于每个字符：
        * 如果当前节点的子节点中已经存在指向该字符的节点，则移动到该子节点。
        * 如果不存在，则创建一个新的子节点，并将其添加到当前节点的子节点集合中，然后移动到新创建的节点。
    3. 当遍历完所有字符后，到达最终节点。将该节点的 `value` 字段设置为传入的 `value`，并设置 `isEndOfWord` 为 `true`。

* **查找（`get(key)`）：**
    1. 从根节点开始。
    2. 遍历键的每个字符。对于每个字符：
        * 如果当前节点的子节点中不存在指向该字符的节点，则说明键不存在，返回 `null`。
        * 如果存在，则移动到该子节点。
    3. 当遍历完所有字符后，到达最终节点。检查该节点的 `isEndOfWord` 标记。如果为 `true`，则返回该节点的 `value`；否则（如果只是一个前缀），返回 `null`。

* **删除（`remove(key)`）：**
    删除操作相对复杂，需要考虑：
    1. 找到键对应的最终节点。
    2. 将该节点的 `value` 设置为 `null`，并 `isEndOfWord` 设置为 `false`（逻辑删除）。
    3. 如果删除后，该节点不再是任何其他键的前缀，并且也没有任何子节点，那么它可以从树中物理删除，需要回溯父节点并移除指向它的引用，一直回溯到第一个有其他作用（是其他键的前缀或有其他子节点）的节点。这通常需要递归实现。

**TrieMap 的特性和优势**

1. **高效的前缀匹配和查找：**
    * **查找时间复杂度：O(L)**，其中 L 是键的长度。这比基于哈希表的 Map 在最坏情况下（哈希冲突严重）的 O(L) 或 O(N) 性能更好，而且在平均情况下哈希表是 O(1)，但 TrieMap 在键长较短时表现出色，且无哈希冲突问题。
    * 特别适合**“前缀搜索”**或**“自动补全”**：可以直接遍历一个前缀对应的节点及其所有子树，找到所有以该前缀开头的键。

2. **空间效率（部分情况下）：**
    * 当键之间有大量公共前缀时，可以显著节省空间，因为共享了节点。
    * 然而，如果键之间前缀很少，或者键的字符集非常大，每个节点有大量子节点指针，那么空间开销可能会比 HashMap 大。

3. **有序性（基于键的前缀）：**
    虽然不是像 TreeMap 那样按键的整体排序，但 TrieMap 在结构上体现了键的前缀有序性，这使得前缀相关的操作非常自然和高效。

4. **键可以是任意序列：**
    尽管最常见的是字符串，但只要能定义元素的顺序和比较，键可以是任何序列（例如，字节数组，整数数组）。

**TrieMap 的应用场景**

* **自动补全/拼写检查：** 用户输入时，快速提供以当前输入为前缀的建议词汇。
* **路由表：** 网络路由器可以使用 Trie 来存储 IP 地址或网络前缀，从而快速查找匹配的路由规则。
* **词典/字典树：** 存储大量词汇，进行快速查找、前缀匹配等操作。
* **IP 地址查找：** 查找某个 IP 地址是否在某个大的网段中。
* **DNS 解析：** 查找域名对应的 IP 地址。
* **文本搜索匹配：** 在文本中查找特定模式。
* **数据压缩：** 通过共享前缀来降低存储冗余。

**TrieMap 的潜在缺点**

* **空间开销：** 如果键的前缀共享不多，或者键的字符集很大（导致每个节点子节点Map/数组大而稀疏），空间效率可能不高。
* **实现复杂度：** 相对于 HashMap，实现 TrieMap 更复杂，尤其是删除操作。
* **非随机访问：** 无法像数组那样通过索引直接访问，访问任何一个键都需要从根节点遍历到对应节点。

**与 HashMap/TreeMap 的比较**

* **HashMap：** 最佳平均时间复杂度 O(1) 用于 `get`, `put`。不保证键的顺序。不擅长前缀搜索。
* **TreeMap：** 基于红黑树实现，所有操作都是 O(log N)。键是排序的。支持范围查询，但前缀搜索不如 TrieMap 直观和高效。
* **TrieMap：** 最佳时间复杂度 O(L) (键长)。特别擅长前缀搜索及自动补全。在大量键有公共前缀时空间效率高。

**总结**

TrieMap 是一种非常有用且强大的数据结构，它利用前缀树的特性，在处理字符串（或其他序列）键的映射和前缀相关操作时展现出卓越的性能。理解其节点结构和操作原理是掌握它的关键。在需要高效前缀搜索和存储大量相关键的场景下，TrieMap 是一个值得考虑的优秀选择。

```go
package trie_map

// TrieNode 表示字典树中的一个节点，包含可选值和子节点指针数组
type TrieNode[T any] struct {
 val      *T             // 节点存储的值，如果为 nil 表示不是一个完整 key
 children []*TrieNode[T] // 子节点数组，长度为字符集大小 R
}

// NewTrieNode 创建一个新的 TrieNode，初始化子节点数组长度为 R
func NewTrieNode[T any](R int) *TrieNode[T] {
 return &TrieNode[T]{
  children: make([]*TrieNode[T], R), // 初始化长度为 R 的子节点数组
 }
}

// TrieMap 是一个基于 Trie 的映射结构，支持字符串键和值的泛型映射
type TrieMap[T any] struct {
 R    int          // 字符集大小，例如 256 表示 ASCII 字符集
 size int          // 当前存储的键值对数量
 root *TrieNode[T] // Trie 树的根节点
}

// NewTrieMap 创建一个空的 TrieMap，使用默认的 ASCII 字符集大小 256
func NewTrieMap[T any]() *TrieMap[T] {
 trieMap := &TrieMap[T]{
  size: 0,
  R:    256, // 默认支持 ASCII 范围内的字符
 }
 trieMap.root = NewTrieNode[T](trieMap.R) // 初始化根节点
 return trieMap
}

// Size 返回 TrieMap 中键值对的数量
func (tm *TrieMap[T]) Size() int {
 return tm.size
}

// GetNode 查找 key 对应的终止节点（若存在）
func GetNode[T any](node *TrieNode[T], key string) *TrieNode[T] {
 if node == nil {
  return nil
 }
 p := node
 for i := 0; i < len(key); i++ {
  if p == nil {
   return nil
  }
  var c byte = key[i]
  p = p.children[c] // 向下查找子节点
 }
 return p
}

// Get 返回 key 对应的值指针，若不存在则返回 nil
func (tm *TrieMap[T]) Get(key string) *T {
 node := GetNode(tm.root, key)
 if node == nil || node.val == nil {
  return nil
 }
 return node.val
}

// ContainsKey 判断是否存在指定 key
func (tm *TrieMap[T]) ContainsKey(key string) bool {
 return tm.Get(key) != nil
}

// HasKeyWithPrefix 判断是否存在某个以 prefix 为前缀的 key
func (tm *TrieMap[T]) HasKeyWithPrefix(prefix string) bool {
 return GetNode(tm.root, prefix) != nil
}

// ShortestPrefixOf 查找 query 的最短前缀，该前缀在 TrieMap 中存在
func (tm *TrieMap[T]) ShortestPrefixOf(query string) string {
 p := tm.root
 for i := 0; i < len(query); i++ {
  if p == nil {
   break
  }
  if p.val != nil {
   return query[:i] // 找到前缀匹配
  }
  var c byte = query[i]
  p = p.children[c]
 }
 if p != nil && p.val != nil {
  return query // 整个 query 是前缀
 }
 return "" // 没有任何前缀匹配
}

// LongestPrefixOf 查找 query 的最长前缀，该前缀在 TrieMap 中存在
func (tm *TrieMap[T]) LongestPrefixOf(query string) string {
 node := tm.root
 max_len := 0
 for i := 0; i < len(query); i++ {
  if node == nil {
   break
  }
  if node.val != nil {
   max_len = i
  }
  var c byte = query[i]
  node = node.children[c]
 }
 if node != nil && node.val != nil {
  return query // 整个 query 是匹配项
 }
 return query[:max_len] // 返回最长匹配前缀
}

// KeysWithPrefix 返回所有以 prefix 开头的键
func (tm *TrieMap[T]) KeysWithPrefix(prefix string) []string {
 var keys []string = make([]string, 0)
 node := GetNode[T](tm.root, prefix)
 if node == nil {
  return keys // 没有该前缀
 }
 tm.traverseForKeysWithPrefix(node, prefix, &keys)
 return keys
}

// traverseForKeysWithPrefix 递归收集所有以当前路径为前缀的 key
func (tm *TrieMap[T]) traverseForKeysWithPrefix(node *TrieNode[T], currentPath string, res *[]string) {
 if node == nil {
  return
 }
 if node.val != nil {
  *res = append(*res, currentPath) // 找到一个完整 key
 }
 for i := 0; i < tm.R; i++ {
  currentPath = currentPath + string(byte(i))
  tm.traverseForKeysWithPrefix(node.children[i], currentPath, res)
  currentPath = currentPath[:len(currentPath)-1] // 回溯
 }
}

// KeysWithPattern 查找所有匹配模式的 key，支持通配符 '.'
func (tm *TrieMap[T]) KeysWithPattern(pattern string) []string {
 var keys []string = make([]string, 0)
 tm.traverseForKeysWithPattern(tm.root, "", pattern, 0, &keys)
 return keys
}

// traverseForKeysWithPattern 回溯遍历支持通配符的模式匹配
func (tm *TrieMap[T]) traverseForKeysWithPattern(node *TrieNode[T], path string, pattern string, i int, keys *[]string) {
 if node == nil {
  return
 }
 if i == len(pattern) {
  if node.val != nil {
   *keys = append(*keys, path)
  }
  return
 }
 c := pattern[i]
 if c == '.' {
  for j := 0; j < tm.R; j++ {
   path = path + string(byte(j))
   tm.traverseForKeysWithPattern(node.children[j], path, pattern, i+1, keys)
   path = path[:len(path)-1]
  }
 } else {
  path = path + string(byte(c))
  tm.traverseForKeysWithPattern(node.children[c], path, pattern, i+1, keys)
  path = path[:len(path)-1]
 }
}

// HasKeyWithPattern 判断是否存在匹配指定模式的 key
func (tm *TrieMap[T]) HasKeyWithPattern(pattern string) bool {
 return len(tm.KeysWithPattern(pattern)) > 0
}

// Put 插入或更新 key 对应的值
func (tm *TrieMap[T]) Put(key string, v T) {
 if !tm.ContainsKey(key) {
  tm.size++ // 是新增 key
 }
 tm.root = tm.putNode(tm.root, key, &v, 0)
}

// putNode 递归构建节点路径，直到 key 的末尾
func (tm *TrieMap[T]) putNode(node *TrieNode[T], key string, val *T, i int) *TrieNode[T] {
 if node == nil {
  node = NewTrieNode[T](tm.R)
 }
 if i == len(key) {
  node.val = val // 在最后一个节点上存储值
  return node
 }
 c := key[i]
 node.children[c] = tm.putNode(node.children[c], key, val, i+1)
 return node
}

// Remove 从 TrieMap 中删除 key
func (tm *TrieMap[T]) Remove(key string) {
 if !tm.ContainsKey(key) {
  return // key 不存在
 }
 tm.root = tm.removeNode(tm.root, key, 0)
 tm.size--
}

// removeNode 删除 key 路径上的值，必要时清除无用节点
func (tm *TrieMap[T]) removeNode(node *TrieNode[T], key string, i int) *TrieNode[T] {
 if node == nil {
  return nil
 }
 if i == len(key) {
  node.val = nil // 删除节点值
 } else {
  c := key[i]
  node.children[c] = tm.removeNode(node.children[c], key, i+1)
 }
 if node.val != nil {
  return node
 }
 for i := 0; i < tm.R; i++ {
  if node.children[i] != nil {
   return node // 有孩子不能删除
  }
 }
 return nil // 无值无子，删除此节点
}

```

---

```go
package trie_map

import (
 "reflect"
 "testing"
)

func TestTrieMap_BasicOperations(t *testing.T) {
 trie := NewTrieMap[int]()

 // Test Put and Get
 trie.Put("apple", 100)
 trie.Put("app", 200)
 trie.Put("banana", 300)

 if v := trie.Get("apple"); v == nil || *v != 100 {
  t.Errorf("expected 100, got %v", v)
 }

 if v := trie.Get("app"); v == nil || *v != 200 {
  t.Errorf("expected 200, got %v", v)
 }

 if v := trie.Get("banana"); v == nil || *v != 300 {
  t.Errorf("expected 300, got %v", v)
 }

 if v := trie.Get("unknown"); v != nil {
  t.Errorf("expected nil for unknown key, got %v", *v)
 }

 // Test ContainsKey
 if !trie.ContainsKey("apple") {
  t.Error("expected ContainsKey(\"apple\") to be true")
 }

 if trie.ContainsKey("unknown") {
  t.Error("expected ContainsKey(\"unknown\") to be false")
 }

 // Test Size
 if size := trie.Size(); size != 3 {
  t.Errorf("expected size 3, got %d", size)
 }
}

func TestTrieMap_PrefixAndPattern(t *testing.T) {
 trie := NewTrieMap[int]()
 trie.Put("apple", 1)
 trie.Put("app", 2)
 trie.Put("apricot", 3)
 trie.Put("bat", 4)
 trie.Put("ball", 5)

 // Test KeysWithPrefix
 prefixKeys := trie.KeysWithPrefix("ap")
 expected := []string{"app", "apple", "apricot"}
 if !reflect.DeepEqual(stringSet(prefixKeys), stringSet(expected)) {
  t.Errorf("KeysWithPrefix failed, got %v, expected %v", prefixKeys, expected)
 }

 // Test ShortestPrefixOf
 query := "applepie"
 shortest := trie.ShortestPrefixOf(query)
 if shortest != "app" {
  t.Errorf("expected shortest prefix to be 'app', got %s", shortest)
 }

 // Test LongestPrefixOf
 longest := trie.LongestPrefixOf(query)
 if longest != "apple" {
  t.Errorf("expected longest prefix to be 'apple', got %s", longest)
 }

 // Test KeysWithPattern
 trie.Put("bake", 6)
 patternKeys := trie.KeysWithPattern("ba..")
 expectedPattern := []string{"ball", "bake"}
 if !reflect.DeepEqual(stringSet(patternKeys), stringSet(expectedPattern)) {
  t.Errorf("KeysWithPattern failed, got %v, expected %v", patternKeys, expectedPattern)
 }

 // Test HasKeyWithPattern
 if !trie.HasKeyWithPattern("b.ll") {
  t.Error("expected HasKeyWithPattern(\"b.ll\") to be true")
 }
}

func TestTrieMap_Remove(t *testing.T) {
 trie := NewTrieMap[int]()
 trie.Put("dog", 10)
 trie.Put("dot", 20)

 trie.Remove("dog")
 if trie.ContainsKey("dog") {
  t.Error("expected 'dog' to be removed")
 }

 if trie.Size() != 1 {
  t.Errorf("expected size to be 1 after removal, got %d", trie.Size())
 }

 // remove nonexistent
 trie.Remove("notfound")
 if trie.Size() != 1 {
  t.Error("removing nonexistent key should not change size")
 }
}

// Helper: make order-insensitive string slice comparison
func stringSet(list []string) map[string]struct{} {
 set := make(map[string]struct{})
 for _, s := range list {
  set[s] = struct{}{}
 }
 return set
}
```
